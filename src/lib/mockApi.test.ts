import { DiagnosticCategory, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { describe,expect,it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { generateProject } from './engine'
import { createExportPackage } from './exporters'
import { mockApiConfig,mockApiFiles,mockApiHandlers,mockApiRoutes } from './mockApi'
import { normalizeMockApiOptions } from './mockApiOptions'

type MockHandler={method:string;path:string;resolver:(input:{request:Request;params:Record<string,string>})=>Response|Promise<Response>}
const executeHandlers=(source:string,options:ReturnType<typeof normalizeMockApiOptions>)=>{
  const http=Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(path:string,resolver:MockHandler['resolver'])=>({method,path,resolver})])),HttpResponse={json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)},module={exports:{} as {handlers:MockHandler[];db:Record<string,Record<string,unknown>[]>;resetMockData:()=>void}},compiled=transpileModule(source,{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.CommonJS}}).outputText
  const requireMock=(id:string)=>id==='msw'?{http,HttpResponse}:id==='./config'?{mockApiOptions:options}:(()=>{throw new Error(`unexpected import ${id}`)})()
  Function('require','exports','module',compiled)(requireMock,module.exports,module)
  return module.exports
}

describe('Mock API 交付包',()=>{
  it('为每张表生成统一 CRUD 路由并使用 :id 路径参数',()=>{
    const project=cloneTemplate('commerce'),routes=mockApiRoutes(project)
    expect(routes).toHaveLength(project.tables.length)
    expect(routes[0]).toMatchObject({list:'/api/users',detail:'/api/users/:id',primaryKey:'id'})
    expect(routes.every(route=>route.methods.join(',')==='GET,POST,PATCH,DELETE')).toBe(true)
  })
  it('生成可编译的 MSW v2 handlers，并包含分页、筛选、白名单和复位能力',()=>{
    const project=cloneTemplate('commerce');project.tables.forEach(table=>table.count=2)
    const data=generateProject(project).data,source=mockApiHandlers(project,data,{latencyMinMs:100,latencyMaxMs:500,failureRate:25,failureStatus:429,envelope:'data-meta'})
    const errors=transpileModule(source,{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.ESNext},reportDiagnostics:true}).diagnostics?.filter(item=>item.category===DiagnosticCategory.Error)??[]
    expect(errors).toEqual([])
    expect(source).toContain("const controlParams = new Set(['q', '_page', '_limit', '_sort', '_order'])")
    expect(source).toContain('const allowedBody =')
    expect(source).toContain('export const resetMockData')
    expect(source).toContain("'X-Total-Count'")
    expect(source).toContain('const requestRandom =')
    expect(source).toContain('const failureHash =')
    expect(source).toContain('const { latencyRoll, failureRoll } = requestRandom(request)')
    expect(source).toContain("'X-Mock-Injected-Failure'")
    expect(source).not.toContain('\n+}\n')
  })
  it('交付八个可落地文件，数据去除内部异常元信息，契约包含 CRUD 和网络配置',async()=>{
    const project=cloneTemplate('testing');project.tables.forEach(table=>table.count=2)
    const result=generateProject(project);result.data.api_requests[0]._mock_meta={field:'status',rule:'enum',mutation:'invalid_enum',expected:'应拒绝'}
    const options={latencyMinMs:80,latencyMaxMs:320,failureRate:12,failureStatus:503,envelope:'data-meta' as const},files=mockApiFiles(project,result.data,options),database=files.find(file=>file.name==='mock-api/db.json')!.content,openapi=files.find(file=>file.name==='mock-api/openapi.json')!.content
    expect(files.map(file=>file.name)).toEqual(['mock-api/db.json','mock-api/config.ts','mock-api/handlers.ts','mock-api/browser.ts','mock-api/server.ts','mock-api/openapi.json','mock-api/routes.json','mock-api/README.md'])
    expect(database).not.toContain('_mock_meta')
    expect(JSON.parse(openapi).paths['/api/api_requests/{id}']).toHaveProperty('patch')
    expect(JSON.parse(openapi)['x-mock-api-behavior']).toEqual({...options,validateForeignKeys:true,deletePolicy:'restrict',nestedRoutes:true})
    const pack=await createExportPackage('mock-api',project,result.data,result.report,'api_requests',{mockApi:options})
    expect(pack.manifest.files).toHaveLength(8)
    expect(pack.manifest.mockApi).toEqual({...options,validateForeignKeys:true,deletePolicy:'restrict',nestedRoutes:true})
    expect(pack.filename).toContain('mock-api.zip')
  })
  it('规范化越界网络参数并固化为独立 config.ts',()=>{expect(normalizeMockApiOptions({latencyMinMs:-1,latencyMaxMs:50_000,failureRate:101,failureStatus:200,envelope:'wat' as never})).toEqual({latencyMinMs:0,latencyMaxMs:10_000,failureRate:100,failureStatus:400,envelope:'plain',validateForeignKeys:true,deletePolicy:'restrict',nestedRoutes:true});expect(mockApiConfig(cloneTemplate('users'),{failureRate:30})).toContain('"failureRate": 30')})
  it('按 Schema 生成外键检查、删除策略和父子嵌套路由',()=>{const project=cloneTemplate('commerce'),data=generateProject(project).data,source=mockApiHandlers(project,data,{deletePolicy:'cascade'}),routes=mockApiRoutes(project),openapi=JSON.parse(mockApiFiles(project,data)[5].content);expect(source).toContain('const invalidReference =');expect(source).toContain('cascadeDependents');expect(source).toContain("errorResponse(422, 'Foreign key not found:");expect(source).toContain("mockApiOptions.deletePolicy === 'restrict'");expect(routes.find(route=>route.resource==='users')?.nested).toEqual(expect.arrayContaining([expect.objectContaining({path:'/api/users/:id/orders',foreignKey:'userId'})]));expect(openapi.paths['/api/users/{id}/orders']).toHaveProperty('get');expect(openapi.paths['/api/orders/{id}'].delete.responses).toHaveProperty('409');expect(openapi.paths['/api/orders'].post.responses).toHaveProperty('422')})
  it('同一父子表存在多条外键时生成不冲突的嵌套路由',()=>{const project=cloneTemplate('testing'),table=project.tables[1],parent=project.tables[0];table.fields[1].ref={tableId:parent.id,field:'id'};table.fields[2].ref={tableId:parent.id,field:'id'};const data=generateProject(project).data,routes=mockApiRoutes(project).find(route=>route.resource===parent.name)!.nested,openapi=JSON.parse(mockApiFiles(project,data)[5].content);expect(routes.map(route=>route.path)).toEqual(expect.arrayContaining([`/api/${parent.name}/:id/${table.name}/by-${table.fields[1].name}`,`/api/${parent.name}/:id/${table.name}/by-${table.fields[2].name}`]));expect(openapi.paths[`/api/${parent.name}/{id}/${table.name}/by-${table.fields[1].name}`]).toHaveProperty('get');expect(openapi.paths[`/api/${parent.name}/{id}/${table.name}/by-${table.fields[2].name}`]).toHaveProperty('get')})
  it('实际运行生成 handler：拒绝悬空外键、阻止误删并支持递归级联',async()=>{
    const project=cloneTemplate('commerce');project.tables.forEach(table=>{table.count=4;table.countByReference=undefined});const data=generateProject(project).data,source=mockApiHandlers(project,data),defaults=normalizeMockApiOptions(),restricted=executeHandlers(source,defaults)
    const postOrder=restricted.handlers.find(handler=>handler.method==='post'&&handler.path==='/api/orders')!,invalid=await postOrder.resolver({request:new Request('http://mock.local/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:999999,status:'待支付'})}),params:{}})
    expect(invalid.status).toBe(422)
    const userId=data.orders[0].userId as number,deleteUser=restricted.handlers.find(handler=>handler.method==='delete'&&handler.path==='/api/users/:id')!,blocked=await deleteUser.resolver({request:new Request(`http://mock.local/api/users/${userId}`,{method:'DELETE'}),params:{id:String(userId)}})
    expect(blocked.status).toBe(409)
    const nested=restricted.handlers.find(handler=>handler.method==='get'&&handler.path==='/api/users/:id/orders')!,nestedResponse=await nested.resolver({request:new Request(`http://mock.local/api/users/${userId}/orders`),params:{id:String(userId)}}),nestedRows=await nestedResponse.json() as Record<string,unknown>[]
    expect(nestedRows.every(row=>row.userId===userId)).toBe(true)
    const cascading=executeHandlers(source,normalizeMockApiOptions({deletePolicy:'cascade'})),cascadeDelete=cascading.handlers.find(handler=>handler.method==='delete'&&handler.path==='/api/users/:id')!,orderIds=new Set(cascading.db.orders.filter(row=>row.userId===userId).map(row=>row.id)),deleted=await cascadeDelete.resolver({request:new Request(`http://mock.local/api/users/${userId}`,{method:'DELETE'}),params:{id:String(userId)}})
    expect(deleted.status).toBe(200);expect(cascading.db.orders.some(row=>row.userId===userId)).toBe(false);expect(cascading.db.order_items.some(row=>orderIds.has(row.orderId))).toBe(false);expect(cascading.db.payments.some(row=>orderIds.has(row.orderId))).toBe(false)
  })
})

import { DiagnosticCategory, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { describe,expect,it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { generateProject } from './engine'
import { createExportPackage } from './exporters'
import { mockApiConfig,mockApiFiles,mockApiHandlers,mockApiRoutes } from './mockApi'
import { normalizeMockApiOptions } from './mockApiOptions'

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
    expect(JSON.parse(openapi)['x-mock-api-behavior']).toEqual(options)
    const pack=await createExportPackage('mock-api',project,result.data,result.report,'api_requests',{mockApi:options})
    expect(pack.manifest.files).toHaveLength(8)
    expect(pack.manifest.mockApi).toEqual(options)
    expect(pack.filename).toContain('mock-api.zip')
  })
  it('规范化越界网络参数并固化为独立 config.ts',()=>{expect(normalizeMockApiOptions({latencyMinMs:-1,latencyMaxMs:50_000,failureRate:101,failureStatus:200,envelope:'wat' as never})).toEqual({latencyMinMs:0,latencyMaxMs:10_000,failureRate:100,failureStatus:400,envelope:'plain'});expect(mockApiConfig(cloneTemplate('users'),{failureRate:30})).toContain('"failureRate": 30')})
})

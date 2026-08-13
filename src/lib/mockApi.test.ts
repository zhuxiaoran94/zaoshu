import { DiagnosticCategory, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { describe,expect,it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { generateProject } from './engine'
import { createExportPackage } from './exporters'
import { mockApiFiles,mockApiHandlers,mockApiRoutes } from './mockApi'

describe('Mock API 交付包',()=>{
  it('为每张表生成统一 CRUD 路由并使用 :id 路径参数',()=>{
    const project=cloneTemplate('commerce'),routes=mockApiRoutes(project)
    expect(routes).toHaveLength(project.tables.length)
    expect(routes[0]).toMatchObject({list:'/api/users',detail:'/api/users/:id',primaryKey:'id'})
    expect(routes.every(route=>route.methods.join(',')==='GET,POST,PATCH,DELETE')).toBe(true)
  })
  it('生成可编译的 MSW v2 handlers，并包含分页、筛选、白名单和复位能力',()=>{
    const project=cloneTemplate('commerce');project.tables.forEach(table=>table.count=2)
    const data=generateProject(project).data,source=mockApiHandlers(project,data)
    const errors=transpileModule(source,{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.ESNext},reportDiagnostics:true}).diagnostics?.filter(item=>item.category===DiagnosticCategory.Error)??[]
    expect(errors).toEqual([])
    expect(source).toContain("const controlParams = new Set(['q', '_page', '_limit', '_sort', '_order'])")
    expect(source).toContain('const allowedBody =')
    expect(source).toContain('export const resetMockData')
    expect(source).toContain("'X-Total-Count'")
  })
  it('交付七个可落地文件，数据去除内部异常元信息，契约包含 CRUD 路径',async()=>{
    const project=cloneTemplate('testing');project.tables.forEach(table=>table.count=2)
    const result=generateProject(project);result.data.api_requests[0]._mock_meta={field:'status',rule:'enum',mutation:'invalid_enum',expected:'应拒绝'}
    const files=mockApiFiles(project,result.data),database=files.find(file=>file.name==='mock-api/db.json')!.content,openapi=files.find(file=>file.name==='mock-api/openapi.json')!.content
    expect(files.map(file=>file.name)).toEqual(['mock-api/db.json','mock-api/handlers.ts','mock-api/browser.ts','mock-api/server.ts','mock-api/openapi.json','mock-api/routes.json','mock-api/README.md'])
    expect(database).not.toContain('_mock_meta')
    expect(JSON.parse(openapi).paths['/api/api_requests/{id}']).toHaveProperty('patch')
    const pack=await createExportPackage('mock-api',project,result.data,result.report,'api_requests')
    expect(pack.manifest.files).toHaveLength(7)
    expect(pack.filename).toContain('mock-api.zip')
  })
})

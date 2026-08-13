import type { DataRow, GeneratedData, ProjectSchema, TableSchema } from '../types'
import { toOpenAPI } from './schemaExport'
import { normalizeMockApiOptions, type MockApiOptions } from './mockApiOptions'

interface MockApiFile { name:string;content:string }
const clean=(row:DataRow)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_mock_meta'))
const primary=(table:TableSchema)=>table.fields.find(field=>field.primaryKey)??table.fields.find(field=>field.unique)??table.fields.find(field=>field.name==='id')??table.fields[0]
const literal=(value:unknown)=>JSON.stringify(value,null,2).replaceAll('</','<\\/')
const relationSpecs=(project:ProjectSchema)=>project.tables.flatMap(child=>child.fields.filter(field=>field.ref).map(field=>{const parent=project.tables.find(table=>table.id===field.ref!.tableId);return parent?{parent:parent.name,child:child.name,foreignKey:field.name,parentField:field.ref!.field}:null}).filter((relation):relation is NonNullable<typeof relation>=>Boolean(relation))).map((relation,_,all)=>{const duplicate=all.filter(candidate=>candidate.parent===relation.parent&&candidate.child===relation.child).length>1,path=`/api/${relation.parent}/:id/${relation.child}${duplicate?`/by-${relation.foreignKey}`:''}`;return{...relation,path,openApiPath:path.replace(':id','{id}')}})

export function mockApiRoutes(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const behavior=normalizeMockApiOptions(options)
  const routes=project.tables.map(table=>({
    resource:table.name,
    label:table.label,
    primaryKey:primary(table).name,
    list:`/api/${table.name}`,
    detail:`/api/${table.name}/:id`,
    methods:['GET','POST','PATCH','DELETE'],
    filters:table.fields.map(field=>field.name),
    behavior,
  }))
  const nested=behavior.nestedRoutes?relationSpecs(project).map(relation=>({...relation,method:'GET'})):[]
  return routes.map(route=>({...route,nested:nested.filter(item=>item.parent===route.resource)}))
}

export function mockApiConfig(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const config={seed:project.seed,...normalizeMockApiOptions(options)}
  return`export const mockApiOptions = ${JSON.stringify(config,null,2)} as const\n`
}

export function mockApiHandlers(project:ProjectSchema,data:GeneratedData,_options?:Partial<MockApiOptions>){
  const initial=Object.fromEntries(project.tables.map(table=>[table.name,(data[table.id]??[]).map(clean)]))
  const definitions=project.tables.map(table=>{
    const key=primary(table)
    return`  { resource: ${JSON.stringify(table.name)}, key: ${JSON.stringify(key.name)}, numericKey: ${key.dataType==='number'}, fields: ${JSON.stringify(table.fields.map(field=>field.name))} },`
  }).join('\n')
  const relationDefinitions=relationSpecs(project).map(relation=>`  { child: ${JSON.stringify(relation.child)}, childField: ${JSON.stringify(relation.foreignKey)}, parent: ${JSON.stringify(relation.parent)}, parentField: ${JSON.stringify(relation.parentField)}, path: ${JSON.stringify(relation.path)} },`).join('\n')
  return `import { http, HttpResponse } from 'msw'
import { mockApiOptions } from './config'

type MockRecord = Record<string, unknown>
type MockDatabase = Record<string, MockRecord[]>
type ResourceDefinition = { resource: string; key: string; numericKey: boolean; fields: readonly string[] }

const initialDb: MockDatabase = ${literal(initial)}
export const db: MockDatabase = structuredClone(initialDb)

const resources: readonly ResourceDefinition[] = [
${definitions}
]
const relations = [
${relationDefinitions}
] as const
const resourceByName = new Map(resources.map(resource => [resource.resource, resource]))
const controlParams = new Set(['q', '_page', '_limit', '_sort', '_order'])
const requestCounts = new Map<string, number>()
const sameId = (left: unknown, right: unknown) => String(left) === String(right)
const jsonBody = async (request: Request) => {
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as MockRecord : null
  } catch {
    return null
  }
}
const allowedBody = (body: MockRecord, resource: ResourceDefinition) =>
  Object.fromEntries(Object.entries(body).filter(([field]) => resource.fields.includes(field)))
const errorResponse = (status: number, message: string) =>
  HttpResponse.json({ error: { status, message } }, { status })
const wrapped = (data: unknown, meta?: MockRecord) =>
  mockApiOptions.envelope === 'plain'
    ? data
    : mockApiOptions.envelope === 'data'
      ? { data }
      : { data, meta: meta ?? {} }

const invalidReference = (body: MockRecord, resource: ResourceDefinition) => {
  if (!mockApiOptions.validateForeignKeys) return null
  for (const relation of relations) {
    if (relation.child !== resource.resource || body[relation.childField] == null) continue
    const exists = db[relation.parent].some(row => sameId(row[relation.parentField], body[relation.childField]))
    if (!exists) return relation
  }
  return null
}
const dependentRows = (resource: ResourceDefinition, row: MockRecord) => relations.flatMap(relation =>
  relation.parent === resource.resource
    ? db[relation.child].filter(child => sameId(child[relation.childField], row[relation.parentField])).map(child => ({ relation, child }))
    : [],
)
const cascadeDependents = (resource: ResourceDefinition, row: MockRecord, visited = new Set<string>()) => {
  const visitKey = resource.resource + ':' + String(row[resource.key])
  if (visited.has(visitKey)) return
  visited.add(visitKey)
  for (const { relation, child } of dependentRows(resource, row)) {
    const childResource = resourceByName.get(relation.child)
    if (childResource) cascadeDependents(childResource, child, visited)
    db[relation.child] = db[relation.child].filter(candidate => candidate !== child)
  }
}

const requestRandom = (request: Request) => {
  const url = new URL(request.url)
  const key = request.method + ' ' + url.pathname + url.search
  const count = (requestCounts.get(key) ?? 0) + 1
  requestCounts.set(key, count)
  let hash = (mockApiOptions.seed ^ count) >>> 0
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0
  }
  const failureHash = Math.imul(hash ^ 0x9e3779b9, 2246822519) >>> 0
  return {
    latencyRoll: hash / 4_294_967_296,
    failureRoll: failureHash / 4_294_967_296,
  }
}

const withNetwork = async (request: Request, resolve: () => Response | Promise<Response>) => {
  const { latencyRoll, failureRoll } = requestRandom(request)
  const span = mockApiOptions.latencyMaxMs - mockApiOptions.latencyMinMs
  const latency = mockApiOptions.latencyMinMs + Math.floor((span + 1) * latencyRoll)
  if (latency > 0) await new Promise(done => setTimeout(done, latency))
  if (failureRoll * 100 < mockApiOptions.failureRate) {
    const response = errorResponse(mockApiOptions.failureStatus, 'Injected mock network failure')
    response.headers.set('X-Mock-Latency', String(latency))
    response.headers.set('X-Mock-Injected-Failure', 'true')
    return response
  }
  const response = await resolve()
  response.headers.set('X-Mock-Latency', String(latency))
  return response
}

export const resetMockData = () => {
  for (const resource of resources) db[resource.resource] = structuredClone(initialDb[resource.resource])
  requestCounts.clear()
}

export const handlers = resources.flatMap(resource => [
  http.get('/api/' + resource.resource, ({ request }) => withNetwork(request, () => {
    const url = new URL(request.url)
    const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase()
    let rows = [...db[resource.resource]]
    if (query) {
      rows = rows.filter(row =>
        Object.values(row).some(value => String(value ?? '').toLocaleLowerCase().includes(query)),
      )
    }
    url.searchParams.forEach((value, field) => {
      if (!controlParams.has(field) && resource.fields.includes(field)) {
        rows = rows.filter(row => String(row[field] ?? '') === value)
      }
    })
    const sort = url.searchParams.get('_sort')
    const order = url.searchParams.get('_order') === 'desc' ? -1 : 1
    if (sort && resource.fields.includes(sort)) {
      rows.sort((left, right) =>
        String(left[sort] ?? '').localeCompare(String(right[sort] ?? ''), undefined, { numeric: true }) * order,
      )
    }
    const page = Math.max(1, Number(url.searchParams.get('_page')) || 1)
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('_limit')) || 20))
    return HttpResponse.json(
      wrapped(rows.slice((page - 1) * limit, page * limit), { page, limit, total: rows.length }),
      { headers: { 'X-Total-Count': String(rows.length) } },
    )
  })),
  http.get('/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, () => {
    const row = db[resource.resource].find(item => sameId(item[resource.key], params.id))
    return row ? HttpResponse.json(wrapped(row)) : errorResponse(404, 'Not found')
  })),
  http.post('/api/' + resource.resource, ({ request }) => withNetwork(request, async () => {
    const input = await jsonBody(request)
    if (!input) return errorResponse(400, 'JSON object required')
    const body = allowedBody(input, resource)
    if (body[resource.key] == null) {
      body[resource.key] = resource.numericKey
        ? Math.max(0, ...db[resource.resource].map(item => Number(item[resource.key]) || 0)) + 1
        : crypto.randomUUID()
    }
    if (db[resource.resource].some(item => sameId(item[resource.key], body[resource.key]))) {
      return errorResponse(409, 'Primary key already exists')
    }
    const invalid = invalidReference(body, resource)
    if (invalid) return errorResponse(422, 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField)
    db[resource.resource].push(body)
    return HttpResponse.json(wrapped(body), { status: 201 })
  })),
  http.patch('/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, async () => {
    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id))
    const input = await jsonBody(request)
    if (index < 0) return errorResponse(404, 'Not found')
    if (!input) return errorResponse(400, 'JSON object required')
    const body = allowedBody(input, resource)
    const candidate = { ...db[resource.resource][index], ...body }
    const invalid = invalidReference(candidate, resource)
    if (invalid) return errorResponse(422, 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField)
    db[resource.resource][index] = {
      ...db[resource.resource][index],
      ...body,
      [resource.key]: db[resource.resource][index][resource.key],
    }
    return HttpResponse.json(wrapped(db[resource.resource][index]))
  })),
  http.delete('/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, () => {
    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id))
    if (index < 0) return errorResponse(404, 'Not found')
    const dependents = dependentRows(resource, db[resource.resource][index])
    if (dependents.length && mockApiOptions.deletePolicy === 'restrict') {
      return errorResponse(409, 'Referenced by ' + dependents.length + ' child record(s)')
    }
    if (dependents.length) cascadeDependents(resource, db[resource.resource][index])
    const [deleted] = db[resource.resource].splice(index, 1)
    return HttpResponse.json(wrapped(deleted))
  })),
])

const relationHandlers = mockApiOptions.nestedRoutes ? relations.map(relation =>
  http.get(relation.path, ({ params, request }) => withNetwork(request, () => {
    const parentResource = resourceByName.get(relation.parent)
    if (!parentResource) return errorResponse(404, 'Parent resource not found')
    const parent = db[relation.parent].find(row => sameId(row[parentResource.key], params.id))
    if (!parent) return errorResponse(404, 'Parent record not found')
    const rows = db[relation.child].filter(row => sameId(row[relation.childField], parent[relation.parentField]))
    return HttpResponse.json(wrapped(rows, { total: rows.length }), { headers: { 'X-Total-Count': String(rows.length) } })
  })),
) : []

handlers.push(...relationHandlers)
`
}

export function mockApiReadme(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const routes=mockApiRoutes(project,options),behavior=normalizeMockApiOptions(options)
  const nested=routes.flatMap(route=>route.nested)
  return`# ${project.name} Mock API

此包由 Mock造数工具生成。数据已固定为 seed ${project.seed}、时间基准 ${project.referenceDate??'2026-08-14T00:00:00.000Z'}，不需要连接服务器或数据库。它只在使用者自己的浏览器或测试进程内运行，不会在 Mock造数工具公共站点创建可写接口。

## 当前网络场景

- 延迟：${behavior.latencyMinMs}–${behavior.latencyMaxMs} ms
- 失败率：${behavior.failureRate}%（HTTP ${behavior.failureStatus}）
- 成功响应：${behavior.envelope==='plain'?'原始 JSON':behavior.envelope==='data'?'\`{ data }\`':'\`{ data, meta }\`'}
- 外键校验：${behavior.validateForeignKeys?'开启，悬空外键返回 HTTP 422':'关闭'}
- 父记录删除：${behavior.deletePolicy==='restrict'?'存在子记录时返回 HTTP 409':'递归级联删除全部后代'}
- 嵌套查询：${behavior.nestedRoutes?`开启，共 ${nested.length} 条父子路由`:'关闭'}
- 确定性：相同 seed、请求方法、URL 和请求次序会得到相同延迟与失败序列；\`resetMockData()\` 同时重置数据与序列。

可以直接修改 \`config.ts\` 调整这些值，范围已在导出时限制为延迟 0–10,000 ms、失败率 0–100%、状态码 400–599。

## 快速接入 MSW v2

\`\`\`bash
npm install -D msw
\`\`\`

浏览器应用入口：

\`\`\`ts
import { startMockApi } from './mock-api/browser'

await startMockApi()
\`\`\`

Node/Vitest 测试：

\`\`\`ts
import { resetMockData, server } from './mock-api/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => { server.resetHandlers(); resetMockData() })
afterAll(() => server.close())
\`\`\`

## 路由

${routes.map(route=>`- \`GET ${route.list}?_page=1&_limit=20&_sort=${route.primaryKey}&_order=asc&q=关键字\`
- \`GET ${route.list}?字段名=精确值\`
- \`GET ${route.detail}\`
- \`POST ${route.list}\`
- \`PATCH ${route.detail}\`
- \`DELETE ${route.detail}\``).join('\n')}

${nested.length?`### 父子嵌套查询\n\n${nested.map(route=>`- \`GET ${route.path}\`（${route.parent} → ${route.child}.${route.foreignKey}）`).join('\n')}\n`:''}

列表响应包含 \`X-Total-Count\`，所有响应包含实际等待毫秒数 \`X-Mock-Latency\`，注入失败额外包含 \`X-Mock-Injected-Failure: true\`；单页最多 1,000 条。POST 自动补充缺失主键并拒绝重复主键，PATCH 不允许修改主键，请求中不属于当前 Schema 的字段会被丢弃。开启外键校验时，POST/PATCH 的悬空外键返回 422。

## 文件

- \`db.json\`：可直接读取或交给 json-server 等兼容工具。
- \`config.ts\`：种子、延迟、失败率、失败状态码和响应格式。
- \`handlers.ts\`：内存 CRUD、分页、搜索、字段筛选、排序与网络场景实现。
- \`browser.ts\` / \`server.ts\`：浏览器和 Node 测试入口。
- \`openapi.json\`：接口契约，可导入 Apifox、Postman 或 Swagger UI。
- \`routes.json\`：机器可读路由与网络行为清单。
`
}

export function mockApiFiles(project:ProjectSchema,data:GeneratedData,options?:Partial<MockApiOptions>):MockApiFile[]{
  const normalized=normalizeMockApiOptions(options)
  const database=Object.fromEntries(project.tables.map(table=>[table.name,(data[table.id]??[]).map(clean)]))
  return[
    {name:'mock-api/db.json',content:JSON.stringify(database,null,2)},
    {name:'mock-api/config.ts',content:mockApiConfig(project,normalized)},
    {name:'mock-api/handlers.ts',content:mockApiHandlers(project,data,normalized)},
    {name:'mock-api/browser.ts',content:"import { setupWorker } from 'msw/browser'\nimport { handlers, resetMockData } from './handlers'\n\nexport { resetMockData }\nexport const worker = setupWorker(...handlers)\nexport const startMockApi = () => worker.start({ onUnhandledRequest: 'bypass' })\n"},
    {name:'mock-api/server.ts',content:"import { setupServer } from 'msw/node'\nimport { handlers, resetMockData } from './handlers'\n\nexport { resetMockData }\nexport const server = setupServer(...handlers)\n"},
    {name:'mock-api/openapi.json',content:JSON.stringify(toOpenAPI(project,normalized),null,2)},
    {name:'mock-api/routes.json',content:JSON.stringify({behavior:normalized,routes:mockApiRoutes(project,normalized)},null,2)},
    {name:'mock-api/README.md',content:mockApiReadme(project,normalized)},
  ]
}

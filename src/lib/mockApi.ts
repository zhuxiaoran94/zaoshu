import type { DataRow, GeneratedData, ProjectSchema, TableSchema } from '../types'
import { toOpenAPI } from './schemaExport'
import { normalizeMockApiOptionsForProject, type MockApiOptions } from './mockApiOptions'

interface MockApiFile { name:string;content:string }
const clean=(row:DataRow)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_mock_meta'))
const primary=(table:TableSchema)=>table.fields.find(field=>field.primaryKey)??table.fields.find(field=>field.unique)??table.fields.find(field=>field.name==='id')??table.fields[0]
const literal=(value:unknown)=>JSON.stringify(value,null,2).replaceAll('</','<\\/')
const relationSpecs=(project:ProjectSchema)=>project.tables.flatMap(child=>child.fields.filter(field=>field.ref).map(field=>{const parent=project.tables.find(table=>table.id===field.ref!.tableId);return parent?{parent:parent.name,child:child.name,foreignKey:field.name,parentField:field.ref!.field}:null}).filter((relation):relation is NonNullable<typeof relation>=>Boolean(relation))).map((relation,_,all)=>{const duplicate=all.filter(candidate=>candidate.parent===relation.parent&&candidate.child===relation.child).length>1,path=`/api/${relation.parent}/:id/${relation.child}${duplicate?`/by-${relation.foreignKey}`:''}`;return{...relation,path,openApiPath:path.replace(':id','{id}')}})
const packageName=(value:string)=>value.toLocaleLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'mock-api-project'
export const mockApiControlRoutes=[
  {method:'GET',path:'/api/__mock/health',description:'检查本地 Mock 数据状态，不经过网络故障注入'},
  {method:'POST',path:'/api/__mock/reset',description:'恢复全部初始数据和请求序列，不经过网络故障注入'},
] as const

export function mockApiRoutes(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const behavior=normalizeMockApiOptionsForProject(project,options)
  const routes=project.tables.map(table=>({
    resource:table.name,
    label:table.label,
    primaryKey:primary(table).name,
    list:`/api/${table.name}`,
    detail:`/api/${table.name}/:id`,
    batch:`/api/${table.name}/_batch`,
    methods:['GET','POST','PATCH','DELETE'],
    filters:table.fields.map(field=>field.name),
    behavior,
  }))
  const nested=behavior.nestedRoutes?relationSpecs(project).map(relation=>({...relation,method:'GET'})):[]
  return routes.map(route=>({...route,nested:nested.filter(item=>item.parent===route.resource)}))
}

export function mockApiConfig(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const config={seed:project.seed,...normalizeMockApiOptionsForProject(project,options)}
  return`export type MockApiRuntimeOptions = {
  seed: number
  latencyMinMs: number
  latencyMaxMs: number
  failureRate: number
  failureStatus: number
  envelope: 'plain' | 'data' | 'data-meta'
  validateForeignKeys: boolean
  deletePolicy: 'restrict' | 'cascade'
  nestedRoutes: boolean
  routeOverrides: Array<{
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    path: string
    latencyMinMs: number
    latencyMaxMs: number
    failureRate: number
    failureStatus: number
    failureMessage: string
  }>
}

export const mockApiOptions: MockApiRuntimeOptions = ${JSON.stringify(config,null,2)}\n`
}

export function mockApiHandlers(project:ProjectSchema,data:GeneratedData,_options?:Partial<MockApiOptions>){
  const initial=Object.fromEntries(project.tables.map(table=>[table.name,(data[table.id]??[]).map(clean)]))
  const definitions=project.tables.map(table=>{
    const key=primary(table)
    return`  { resource: ${JSON.stringify(table.name)}, key: ${JSON.stringify(key.name)}, numericKey: ${key.dataType==='number'}, fields: ${JSON.stringify(table.fields.map(field=>field.name))} },`
  }).join('\n')
  const relationDefinitions=relationSpecs(project).map(relation=>`  { child: ${JSON.stringify(relation.child)}, childField: ${JSON.stringify(relation.foreignKey)}, parent: ${JSON.stringify(relation.parent)}, parentField: ${JSON.stringify(relation.parentField)}, path: ${JSON.stringify(relation.path)} },`).join('\n')
  return `import { http, HttpResponse, type JsonBodyType } from 'msw'
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
const pathMatches = (pattern: string, pathname: string) => {
  const expected = pattern.split('/'), actual = pathname.split('/')
  return expected.length === actual.length && expected.every((part, index) => part.startsWith(':') || part === actual[index])
}
const requestScenario = (request: Request) => {
  const pathname = new URL(request.url).pathname
  return mockApiOptions.routeOverrides.find(rule => rule.method === request.method && pathMatches(rule.path, pathname)) ?? mockApiOptions
}
const requestJson = async (request: Request) => {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as MockRecord : null
const jsonBody = async (request: Request) => asRecord(await requestJson(request))
const allowedBody = (body: MockRecord, resource: ResourceDefinition) =>
  Object.fromEntries(Object.entries(body).filter(([field]) => resource.fields.includes(field)))
const errorResponse = (status: number, message: string, details?: MockRecord) =>
  HttpResponse.json({ error: { status, message, ...(details ?? {}) } }, { status })
const wrapped = (data: unknown, meta?: MockRecord): JsonBodyType => (
  mockApiOptions.envelope === 'plain'
    ? data
    : mockApiOptions.envelope === 'data'
      ? { data }
      : { data, meta: meta ?? {} }
) as JsonBodyType

const invalidReference = (body: MockRecord, resource: ResourceDefinition) => {
  if (!mockApiOptions.validateForeignKeys) return null
  for (const relation of relations) {
    if (relation.child !== resource.resource || body[relation.childField] == null) continue
    const exists = db[relation.parent].some(row => sameId(row[relation.parentField], body[relation.childField]))
    if (!exists) return relation
  }
  return null
}
type InsertResult = { ok: true; row: MockRecord } | { ok: false; status: number; message: string }
const insertRecord = (input: MockRecord, resource: ResourceDefinition): InsertResult => {
  const body = allowedBody(input, resource)
  if (body[resource.key] == null) {
    body[resource.key] = resource.numericKey
      ? Math.max(0, ...db[resource.resource].map(item => Number(item[resource.key]) || 0)) + 1
      : crypto.randomUUID()
  }
  if (db[resource.resource].some(item => sameId(item[resource.key], body[resource.key]))) {
    return { ok: false, status: 409, message: 'Primary key already exists' }
  }
  const invalid = invalidReference(body, resource)
  if (invalid) return { ok: false, status: 422, message: 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField }
  db[resource.resource].push(body)
  return { ok: true, row: body }
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
  const scenario = requestScenario(request)
  const { latencyRoll, failureRoll } = requestRandom(request)
  const span = scenario.latencyMaxMs - scenario.latencyMinMs
  const latency = scenario.latencyMinMs + Math.floor((span + 1) * latencyRoll)
  if (latency > 0) await new Promise(done => setTimeout(done, latency))
  if (failureRoll * 100 < scenario.failureRate) {
    const response = errorResponse(scenario.failureStatus, 'failureMessage' in scenario ? scenario.failureMessage : 'Injected mock network failure')
    response.headers.set('X-Mock-Latency', String(latency))
    response.headers.set('X-Mock-Injected-Failure', 'true')
    if ('path' in scenario) response.headers.set('X-Mock-Route-Override', scenario.method + ' ' + scenario.path)
    return response
  }
  const response = await resolve()
  response.headers.set('X-Mock-Latency', String(latency))
  if ('path' in scenario) response.headers.set('X-Mock-Route-Override', scenario.method + ' ' + scenario.path)
  return response
}

export const resetMockData = () => {
  for (const resource of resources) db[resource.resource] = structuredClone(initialDb[resource.resource])
  requestCounts.clear()
}

export const handlers = resources.flatMap(resource => [
  http.get('*/api/' + resource.resource, ({ request }) => withNetwork(request, () => {
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
  http.get('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, () => {
    const row = db[resource.resource].find(item => sameId(item[resource.key], params.id))
    return row ? HttpResponse.json(wrapped(row)) : errorResponse(404, 'Not found')
  })),
  http.post('*/api/' + resource.resource, ({ request }) => withNetwork(request, async () => {
    const input = await jsonBody(request)
    if (!input) return errorResponse(400, 'JSON object required')
    const result = insertRecord(input, resource)
    return result.ok ? HttpResponse.json(wrapped(result.row), { status: 201 }) : errorResponse(result.status, result.message)
  })),
  http.patch('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, async () => {
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
  http.delete('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, () => {
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

const batchHandlers = resources.map(resource =>
  http.post('*/api/' + resource.resource + '/_batch', ({ request }) => withNetwork(request, async () => {
    const payload = await requestJson(request)
    const values = Array.isArray(payload) ? payload : asRecord(payload)?.items
    if (!Array.isArray(values) || values.length === 0) return errorResponse(400, 'Non-empty items array required')
    if (values.length > 1000) return errorResponse(400, 'Batch limit is 1000 records')
    const snapshot = structuredClone(db[resource.resource]), created: MockRecord[] = []
    for (let index = 0; index < values.length; index++) {
      const input = asRecord(values[index])
      if (!input) {
        db[resource.resource] = snapshot
        return errorResponse(400, 'Each batch item must be a JSON object', { index })
      }
      const result = insertRecord(input, resource)
      if (!result.ok) {
        db[resource.resource] = snapshot
        return errorResponse(result.status, result.message, { index })
      }
      created.push(result.row)
    }
    return HttpResponse.json(wrapped(created, { created: created.length }), { status: 201 })
  })),
)

const relationHandlers = mockApiOptions.nestedRoutes ? relations.map(relation =>
  http.get('*' + relation.path, ({ params, request }) => withNetwork(request, () => {
    const parentResource = resourceByName.get(relation.parent)
    if (!parentResource) return errorResponse(404, 'Parent resource not found')
    const parent = db[relation.parent].find(row => sameId(row[parentResource.key], params.id))
    if (!parent) return errorResponse(404, 'Parent record not found')
    const rows = db[relation.child].filter(row => sameId(row[relation.childField], parent[relation.parentField]))
    return HttpResponse.json(wrapped(rows, { total: rows.length }), { headers: { 'X-Total-Count': String(rows.length) } })
  })),
) : []

const databaseSummary = () => ({
  status: 'ok',
  seed: mockApiOptions.seed,
  tables: resources.length,
  rows: Object.fromEntries(resources.map(resource => [resource.resource, db[resource.resource].length])),
})
const controlHandlers = [
  http.get('*/api/__mock/health', () => HttpResponse.json(wrapped(databaseSummary()))),
  http.post('*/api/__mock/reset', () => {
    resetMockData()
    return HttpResponse.json(wrapped(databaseSummary()))
  }),
]

handlers.unshift(...controlHandlers)
handlers.push(...batchHandlers, ...relationHandlers)
`
}

export function mockApiReadme(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const routes=mockApiRoutes(project,options),behavior=normalizeMockApiOptionsForProject(project,options)
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
- 单路由覆盖：${behavior.routeOverrides.length?`${behavior.routeOverrides.length} 条（${behavior.routeOverrides.map(rule=>`${rule.method} ${rule.path} → ${rule.latencyMinMs}–${rule.latencyMaxMs} ms / ${rule.failureRate}% HTTP ${rule.failureStatus}`).join('；')}）`:'无，全部使用全局网络场景'}
- 确定性：相同 seed、请求方法、URL 和请求次序会得到相同延迟与失败序列；\`resetMockData()\` 同时重置数据与序列。

可以直接修改 \`config.ts\` 调整这些值，范围已在导出时限制为延迟 0–10,000 ms、失败率 0–100%、状态码 400–599。单路由覆盖命中时会返回 \`X-Mock-Route-Override: METHOD /api/path\`，便于测试确认实际采用的规则。

## 独立运行测试

\`\`\`bash
npm install
npm run typecheck
npm test
\`\`\`

包内测试会真实启动 MSW Node server，验证分页、CRUD、原子批量写入、控制接口、复位、外键、删除策略和嵌套路由。

## 接入已有项目

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
- \`POST ${route.batch}\`（1–1,000 条，失败整批回滚）
- \`PATCH ${route.detail}\`
- \`DELETE ${route.detail}\``).join('\n')}

### 控制接口

- \`GET /api/__mock/health\`：返回 seed、数据表数量及各表当前行数。
- \`POST /api/__mock/reset\`：恢复全部初始数据并重置网络场景请求序列。

控制接口不经过延迟和失败注入，确保极端故障场景下仍能检查与复位；它们只存在于本地 MSW 内存环境，不是远程管理接口。

${nested.length?`### 父子嵌套查询\n\n${nested.map(route=>`- \`GET ${route.path}\`（${route.parent} → ${route.child}.${route.foreignKey}）`).join('\n')}\n`:''}

列表响应包含 \`X-Total-Count\`，业务响应包含实际等待毫秒数 \`X-Mock-Latency\`，注入失败额外包含 \`X-Mock-Injected-Failure: true\`；单页最多 1,000 条。POST 自动补充缺失主键并拒绝重复主键，PATCH 不允许修改主键，请求中不属于当前 Schema 的字段会被丢弃。开启外键校验时，POST/PATCH 的悬空外键返回 422。批量接口接受 JSON 数组或 \`{ items: [] }\`，任一条格式、主键或外键失败都会恢复该表到请求前状态，并在错误中返回从 0 开始的 \`index\`。

## 文件

- \`db.json\`：可直接读取或交给 json-server 等兼容工具。
- \`package.json\` / \`tsconfig.json\` / \`vitest.config.ts\`：独立可运行的测试工程配置，依赖使用精确版本。
- \`handlers.test.ts\`：真实请求验证分页、CRUD、批量回滚、控制接口、复位与关系策略。
- \`config.ts\`：种子、延迟、失败率、失败状态码和响应格式。
- \`handlers.ts\`：内存 CRUD、分页、搜索、字段筛选、排序与网络场景实现。
- \`browser.ts\` / \`server.ts\`：浏览器和 Node 测试入口。
- \`openapi.json\`：接口契约，可导入 Apifox、Postman 或 Swagger UI。
- \`routes.json\`：机器可读路由与网络行为清单。
`
}

export function mockApiSmokeTests(project:ProjectSchema){
  const first=project.tables[0],firstPrimary=primary(first),relations=relationSpecs(project),relation=relations[0]
  const [nestedBefore,nestedAfter]=relation?.path.split(':id')??['','']
  return `import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mockApiOptions } from './config'
import { db } from './handlers'
import { resetMockData, server } from './server'

const origin = 'http://localhost'
const unwrap = (body: unknown) => body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body
const configuredRouteOverrides = structuredClone(mockApiOptions.routeOverrides)

beforeAll(() => { Object.assign(mockApiOptions, { latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, routeOverrides: [] }); server.listen({ onUnhandledRequest: 'error' }) })
afterEach(() => { Object.assign(mockApiOptions, { latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, routeOverrides: [] }); server.resetHandlers(); resetMockData() })
afterAll(() => server.close())

describe(${JSON.stringify(project.name+' Mock API')}, () => {
  it('列表支持分页并返回总数', async () => {
    const response = await fetch(origin + ${JSON.stringify(`/api/${first.name}?_page=1&_limit=2`)})
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('X-Total-Count'))).toBe(db[${JSON.stringify(first.name)}].length)
    expect(unwrap(await response.json())).toHaveLength(Math.min(2, db[${JSON.stringify(first.name)}].length))
  })

  it('完成新增、修改、删除并可复位', async () => {
    const createdResponse = await fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(createdResponse.status).toBe(201)
    const created = unwrap(await createdResponse.json()) as Record<string, unknown>, id = created[${JSON.stringify(firstPrimary.name)}]
    const patchedResponse = await fetch(origin + ${JSON.stringify(`/api/${first.name}/`)} + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ${JSON.stringify(firstPrimary.name)}: 'cannot-change' }) })
    expect(patchedResponse.status).toBe(200)
    expect((unwrap(await patchedResponse.json()) as Record<string, unknown>)[${JSON.stringify(firstPrimary.name)}]).toBe(id)
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}/`)} + id, { method: 'DELETE' })).status).toBe(200)
    resetMockData(); expect(db[${JSON.stringify(first.name)}].some(row => String(row[${JSON.stringify(firstPrimary.name)}]) === String(id))).toBe(false)
  })

  it('批量写入原子回滚，并通过控制接口检查和复位', async () => {
    const table = ${JSON.stringify(first.name)}, initialCount = db[table].length
    const created = await fetch(origin + ${JSON.stringify(`/api/${first.name}/_batch`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{}, {}]) })
    expect(created.status).toBe(201)
    expect(unwrap(await created.json())).toHaveLength(2)
    const beforeFailure = db[table].length, existingId = db[table][0][${JSON.stringify(firstPrimary.name)}]
    const failed = await fetch(origin + ${JSON.stringify(`/api/${first.name}/_batch`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{}, { ${JSON.stringify(firstPrimary.name)}: existingId }]) })
    expect(failed.status).toBe(409)
    expect((await failed.json() as { error: { index: number } }).error.index).toBe(1)
    expect(db[table]).toHaveLength(beforeFailure)
    mockApiOptions.failureRate = 100
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}`)})).status).toBe(mockApiOptions.failureStatus)
    const health = await fetch(origin + '/api/__mock/health')
    expect(health.status).toBe(200)
    expect((unwrap(await health.json()) as { rows: Record<string, number> }).rows[table]).toBe(beforeFailure)
    expect((await fetch(origin + '/api/__mock/reset', { method: 'POST' })).status).toBe(200)
    mockApiOptions.failureRate = 0
    expect(db[table]).toHaveLength(initialCount)
  })${relation?`

  it('执行 Schema 外键、删除策略与嵌套路由', async () => {
    const parent = db[${JSON.stringify(relation.parent)}][0], parentId = parent[${JSON.stringify(relation.parentField)}]
    if (mockApiOptions.validateForeignKeys) {
      const invalid = await fetch(origin + ${JSON.stringify(`/api/${relation.child}`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ${JSON.stringify(relation.foreignKey)}: '__missing_parent__' }) })
      expect(invalid.status).toBe(422)
    }
    if (mockApiOptions.nestedRoutes) {
      const nested = await fetch(origin + ${JSON.stringify(nestedBefore)} + parentId + ${JSON.stringify(nestedAfter)})
      expect(nested.status).toBe(200)
      const rows = unwrap(await nested.json()) as Record<string, unknown>[]
      expect(rows.every(row => String(row[${JSON.stringify(relation.foreignKey)}]) === String(parentId))).toBe(true)
    }
    const hasChildren = db[${JSON.stringify(relation.child)}].some(row => String(row[${JSON.stringify(relation.foreignKey)}]) === String(parentId))
    const deleted = await fetch(origin + ${JSON.stringify(`/api/${relation.parent}/`)} + parentId, { method: 'DELETE' })
    expect(deleted.status).toBe(mockApiOptions.deletePolicy === 'restrict' && hasChildren ? 409 : 200)
  })`:''}

  it('只在目标接口应用已配置的单路由场景', async () => {
    const rule = configuredRouteOverrides[0]
    if (!rule) return
    mockApiOptions.routeOverrides = [{ ...rule, latencyMinMs: 0, latencyMaxMs: 0, failureRate: 100 }]
    const path = rule.path.replace(':id', '__smoke__'), init = ['POST', 'PATCH'].includes(rule.method)
      ? { method: rule.method, headers: { 'content-type': 'application/json' }, body: '{}' }
      : { method: rule.method }
    const response = await fetch(origin + path, init)
    expect(response.status).toBe(rule.failureStatus)
    expect(response.headers.get('X-Mock-Route-Override')).toBe(rule.method + ' ' + rule.path)
    expect((await response.json() as { error: { message: string } }).error.message).toBe(rule.failureMessage)
  })
})
`
}

export function mockApiProjectFiles(project:ProjectSchema):MockApiFile[]{return[
  {name:'mock-api/package.json',content:JSON.stringify({name:`${packageName(project.name)}-mock-api`,private:true,version:'1.0.0',type:'module',engines:{node:'>=18'},scripts:{typecheck:'tsc --noEmit',test:'vitest run',testWatch:'vitest'},devDependencies:{'@types/node':'22.10.2',msw:'2.7.3',typescript:'5.7.3',vitest:'3.2.7'}},null,2)},
  {name:'mock-api/tsconfig.json',content:JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,lib:['ES2022','DOM','ESNext.Disposable'],types:['node','vitest/globals'],noEmit:true},include:['./*.ts']},null,2)},
  {name:'mock-api/vitest.config.ts',content:"import { defineConfig } from 'vitest/config'\n\nexport default defineConfig({ test: { environment: 'node', testTimeout: 15_000 } })\n"},
  {name:'mock-api/handlers.test.ts',content:mockApiSmokeTests(project)},
  {name:'mock-api/.gitignore',content:'node_modules\ncoverage\n'},
]}

export function mockApiFiles(project:ProjectSchema,data:GeneratedData,options?:Partial<MockApiOptions>):MockApiFile[]{
  const normalized=normalizeMockApiOptionsForProject(project,options)
  const database=Object.fromEntries(project.tables.map(table=>[table.name,(data[table.id]??[]).map(clean)]))
  return[
    ...mockApiProjectFiles(project),
    {name:'mock-api/db.json',content:JSON.stringify(database,null,2)},
    {name:'mock-api/config.ts',content:mockApiConfig(project,normalized)},
    {name:'mock-api/handlers.ts',content:mockApiHandlers(project,data,normalized)},
    {name:'mock-api/browser.ts',content:"import { setupWorker } from 'msw/browser'\nimport { handlers, resetMockData } from './handlers'\n\nexport { resetMockData }\nexport const worker = setupWorker(...handlers)\nexport const startMockApi = () => worker.start({ onUnhandledRequest: 'bypass' })\n"},
    {name:'mock-api/server.ts',content:"import { setupServer } from 'msw/node'\nimport { handlers, resetMockData } from './handlers'\n\nexport { resetMockData }\nexport const server = setupServer(...handlers)\n"},
    {name:'mock-api/openapi.json',content:JSON.stringify(toOpenAPI(project,normalized),null,2)},
    {name:'mock-api/routes.json',content:JSON.stringify({behavior:normalized,controlRoutes:mockApiControlRoutes,routes:mockApiRoutes(project,normalized)},null,2)},
    {name:'mock-api/README.md',content:mockApiReadme(project,normalized)},
  ]
}

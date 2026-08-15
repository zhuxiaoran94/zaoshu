import type { DataRow, GeneratedData, ProjectSchema, TableSchema } from '../types'
import { ENUM_VALUES } from '../data/enumValues'
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
  {method:'POST',path:'/api/__mock/reset',description:'恢复全部初始数据并清空请求序列、轨迹和快照，不经过网络故障注入'},
  {method:'GET',path:'/api/__mock/requests',description:'查询最近 500 条脱敏请求轨迹，不经过网络故障注入'},
  {method:'DELETE',path:'/api/__mock/requests',description:'清空本地请求轨迹，不经过网络故障注入'},
  {method:'GET',path:'/api/__mock/snapshots',description:'列出最多 10 个本地内存场景快照'},
  {method:'POST',path:'/api/__mock/snapshots',description:'创建或覆盖本地内存场景快照，单个最多 5 MiB'},
  {method:'DELETE',path:'/api/__mock/snapshots',description:'清空全部本地内存场景快照'},
  {method:'POST',path:'/api/__mock/snapshots/:name/restore',description:'恢复指定场景快照的整库数据'},
  {method:'DELETE',path:'/api/__mock/snapshots/:name',description:'删除指定场景快照'},
  {method:'POST',path:'/api/__mock/transactions',description:'原子执行最多 100 步受限跨表数据事务'},
  {method:'DELETE',path:'/api/__mock/idempotency',description:'清空本地幂等响应缓存，不改变业务数据'},
  {method:'GET',path:'/api/__mock/expectations',description:'列出接口调用次数与状态码验收结果'},
  {method:'POST',path:'/api/__mock/expectations',description:'添加最多 100 条当前 Schema 路由调用预期'},
  {method:'DELETE',path:'/api/__mock/expectations',description:'清空全部接口调用预期'},
  {method:'POST',path:'/api/__mock/expectations/reset',description:'保留调用预期并将实际计数清零'},
  {method:'GET',path:'/api/__mock/expectations/verify',description:'汇总验收；未满足或超限时返回 409'},
  {method:'DELETE',path:'/api/__mock/expectations/:id',description:'删除单条接口调用预期'},
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
    methods:['GET','POST','PUT','PATCH','DELETE'],
    batchMethods:['POST','PATCH','DELETE'],
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
  validateSchema: boolean
  validateForeignKeys: boolean
  deletePolicy: 'restrict' | 'cascade'
  nestedRoutes: boolean
  routeOverrides: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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
    const validation=table.fields.map(field=>{const source=field.values?.length?field.values:ENUM_VALUES[field.generator],values=source?.map(value=>field.dataType==='number'&&Number.isFinite(Number(value))?Number(value):field.dataType==='boolean'&&['true','false'].includes(String(value))?String(value)==='true':value);return{name:field.name,type:field.dataType==='date'?'string':field.dataType,required:field.name!==key.name&&(field.missing??0)===0&&(field.nullable??0)===0&&!field.condition,nullable:Boolean(field.nullable)||field.condition?.otherwise==='null',...(values?.length?{values}:{}),...(field.min!==undefined?{min:field.min}:{}),...(field.max!==undefined?{max:field.max}:{}),...(field.length!==undefined?{maxLength:field.length}:{})}})
    return`  { resource: ${JSON.stringify(table.name)}, key: ${JSON.stringify(key.name)}, numericKey: ${key.dataType==='number'}, fields: ${JSON.stringify(table.fields.map(field=>field.name))}, uniqueFields: ${JSON.stringify(table.fields.filter(field=>field.unique&&field.name!==key.name).map(field=>field.name))}, validation: ${literal(validation)} },`
  }).join('\n')
  const relationDefinitions=relationSpecs(project).map(relation=>`  { child: ${JSON.stringify(relation.child)}, childField: ${JSON.stringify(relation.foreignKey)}, parent: ${JSON.stringify(relation.parent)}, parentField: ${JSON.stringify(relation.parentField)}, path: ${JSON.stringify(relation.path)} },`).join('\n')
  return `import { http, HttpResponse, type JsonBodyType } from 'msw'
import { mockApiOptions } from './config'

type MockRecord = Record<string, unknown>
type MockDatabase = Record<string, MockRecord[]>
type FieldValidation = { name: string; type: string; required: boolean; nullable: boolean; values?: unknown[]; min?: number; max?: number; maxLength?: number }
type ResourceDefinition = { resource: string; key: string; numericKey: boolean; fields: readonly string[]; uniqueFields: readonly string[]; validation: readonly FieldValidation[] }
type ValidationIssue = { field: string; rule: string; message: string }
type FilterResult = { ok: true; rows: MockRecord[] } | { ok: false; response: Response }
export type MockRequestLog = { id: string; sequence: number; method: string; path: string; status: number; latencyMs: number; injectedFailure: boolean; idempotentReplay: boolean; routeOverride?: string }
export type MockSnapshotSummary = { name: string; revision: number; bytes: number; totalRows: number; rows: Record<string, number> }
type StoredSnapshot = { summary: MockSnapshotSummary; database: MockDatabase }
type SnapshotResult = { ok: true; snapshot: MockSnapshotSummary; replaced: boolean } | { ok: false; status: number; message: string }
type ResolvedValue = { ok: true; value: unknown } | { ok: false; message: string }
type CachedMockResponse = { status: number; statusText: string; headers: [string, string][]; body: string; bytes: number }
type MockExpectation = { id: string; method: string; path: string; minCalls: number; maxCalls?: number; statuses?: number[]; calls: number; observedStatuses: Record<string, number> }

const initialDb: MockDatabase = ${literal(initial)}
export const db: MockDatabase = structuredClone(initialDb)

const resources: readonly ResourceDefinition[] = [
${definitions}
]
const relations = [
${relationDefinitions}
] as const
const resourceByName = new Map(resources.map(resource => [resource.resource, resource]))
const controlParams = new Set(['q', '_page', '_limit', '_sort', '_order', '_cursor', '_fields', '_expand'])
const filterOperators = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts', 'ends', 'in', 'isnull'])
const requestCounts = new Map<string, number>()
export const requestLog: MockRequestLog[] = []
let requestSequence = 0
const SNAPSHOT_LIMIT = 10
const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024
const TRANSACTION_LIMIT = 100
const TRANSACTION_MAX_BYTES = 1024 * 1024
const IDEMPOTENCY_LIMIT = 100
const IDEMPOTENCY_MAX_BYTES = 10 * 1024 * 1024
const EXPECTATION_LIMIT = 100
const snapshotStore = new Map<string, StoredSnapshot>()
let snapshotRevision = 0
const idempotencyCache = new Map<string, { signature: string; response: CachedMockResponse }>()
const idempotencyInFlight = new Map<string, { signature: string; promise: Promise<CachedMockResponse> }>()
let idempotencyBytes = 0
const mockExpectations: MockExpectation[] = []
let expectationSequence = 0
const cursorSecret = globalThis.crypto?.randomUUID?.() ?? 'mock-cursor-' + mockApiOptions.seed
const sameId = (left: unknown, right: unknown) => String(left) === String(right)
const pathMatches = (pattern: string, pathname: string) => {
  const expected = pattern.split('/'), actual = pathname.split('/')
  return expected.length === actual.length && expected.every((part, index) => part.startsWith(':') || part === actual[index])
}
const requestScenario = (request: Request) => {
  const pathname = new URL(request.url).pathname
  return mockApiOptions.routeOverrides.find(rule => rule.method === request.method && pathMatches(rule.path, pathname)) ?? mockApiOptions
}
const expectationRouteKeys = new Set([
  ...resources.flatMap(resource => [
    'GET /api/' + resource.resource,
    'GET /api/' + resource.resource + '/:id',
    'PUT /api/' + resource.resource + '/:id',
    'POST /api/' + resource.resource,
    'PATCH /api/' + resource.resource + '/:id',
    'DELETE /api/' + resource.resource + '/:id',
    'POST /api/' + resource.resource + '/_batch',
    'PATCH /api/' + resource.resource + '/_batch',
    'DELETE /api/' + resource.resource + '/_batch',
  ]),
  ...(mockApiOptions.nestedRoutes ? relations.map(relation => 'GET ' + relation.path) : []),
])
const expectationView = (expectation: MockExpectation) => {
  const invalidStatuses = Object.entries(expectation.observedStatuses).filter(([status]) => expectation.statuses && !expectation.statuses.includes(Number(status))).reduce((sum, [, count]) => sum + count, 0)
  const outcome = invalidStatuses > 0 || expectation.maxCalls !== undefined && expectation.calls > expectation.maxCalls ? 'failed' : expectation.calls < expectation.minCalls ? 'pending' : 'passed'
  return { ...structuredClone(expectation), invalidStatuses, outcome }
}
const recordExpectations = (method: string, pathname: string, status: number) => {
  for (const expectation of mockExpectations) if (expectation.method === method && pathMatches(expectation.path, pathname)) {
    expectation.calls += 1
    expectation.observedStatuses[String(status)] = (expectation.observedStatuses[String(status)] ?? 0) + 1
  }
}
const clearMockExpectations = () => { const cleared = mockExpectations.length; mockExpectations.length = 0; expectationSequence = 0; return cleared }
const resetMockExpectationCounts = () => { for (const expectation of mockExpectations) { expectation.calls = 0; expectation.observedStatuses = {} }; return mockExpectations.length }
const addMockExpectation = (input: unknown) => {
  const body = asRecord(input)
  if (!body || Object.keys(body).some(field => !['method', 'path', 'minCalls', 'maxCalls', 'statuses'].includes(field))) return { ok: false as const, status: 400, message: 'Expectation accepts method, path, minCalls, maxCalls and statuses only' }
  if (mockExpectations.length >= EXPECTATION_LIMIT) return { ok: false as const, status: 409, message: 'Expectation limit is 100' }
  const method = typeof body.method === 'string' ? body.method.toUpperCase() : '', path = typeof body.path === 'string' ? body.path : ''
  if (!expectationRouteKeys.has(method + ' ' + path)) return { ok: false as const, status: 400, message: 'Expectation route is not part of the current Schema' }
  const minCalls = body.minCalls === undefined ? 1 : body.minCalls, maxCalls = body.maxCalls
  if (!Number.isInteger(minCalls) || Number(minCalls) < 0 || Number(minCalls) > 10_000 || maxCalls !== undefined && (!Number.isInteger(maxCalls) || Number(maxCalls) < Number(minCalls) || Number(maxCalls) > 10_000)) return { ok: false as const, status: 400, message: 'minCalls/maxCalls must be integers from 0 to 10000 and maxCalls must be at least minCalls' }
  const statuses = body.statuses
  if (statuses !== undefined && (!Array.isArray(statuses) || statuses.length === 0 || statuses.length > 20 || statuses.some(status => !Number.isInteger(status) || status < 100 || status > 599))) return { ok: false as const, status: 400, message: 'statuses must contain 1-20 HTTP status codes' }
  const expectation: MockExpectation = { id: 'expectation-' + String(++expectationSequence).padStart(3, '0'), method, path, minCalls: Number(minCalls), ...(maxCalls === undefined ? {} : { maxCalls: Number(maxCalls) }), ...(statuses === undefined ? {} : { statuses: [...new Set(statuses as number[])] }), calls: 0, observedStatuses: {} }
  mockExpectations.push(expectation)
  return { ok: true as const, expectation: expectationView(expectation) }
}
const requestJson = async (request: Request) => {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}
const comparable = (value: unknown, type: string) => {
  if (value == null) return null
  if (type === 'number') { const number = Number(value); return Number.isFinite(number) ? number : null }
  if (type === 'boolean') return value === true || value === 'true' ? 1 : value === false || value === 'false' ? 0 : null
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? Date.parse(String(value)) : NaN
  return Number.isFinite(date) ? date : String(value)
}
const textFingerprint = (value: string) => {
  let first = 2166136261, second = 2246822519
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 3266489917) }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0') + '-' + value.length.toString(16)
}
const encodeCursor = (payload: MockRecord) => {
  const json = JSON.stringify(payload), bytes = new TextEncoder().encode(json)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') + '.' + textFingerprint(json + ':' + cursorSecret)
}
const decodeCursor = (value: string) => {
  if (!/^[a-f0-9]{2,8192}\.[a-f0-9-]{17,40}$/.test(value) || value.length > 4200) return null
  try {
    const [hex, signature] = value.split('.'), bytes = new Uint8Array((hex.match(/.{2}/g) ?? []).map(byte => Number.parseInt(byte, 16))), json = new TextDecoder().decode(bytes)
    if (hex.length % 2 !== 0 || signature !== textFingerprint(json + ':' + cursorSecret)) return null
    return asRecord(JSON.parse(json))
  } catch { return null }
}
const cursorQueryFingerprint = (url: URL) => {
  const entries: string[] = []
  url.searchParams.forEach((value, key) => { if (!['_cursor', '_page', '_limit'].includes(key)) entries.push(encodeURIComponent(key) + '=' + encodeURIComponent(value)) })
  return textFingerprint(entries.sort().join('&'))
}
const responseShape = (url: URL, resource: ResourceDefinition) => {
  const fieldInput = url.searchParams.get('_fields'), expandInput = url.searchParams.get('_expand'), fields = fieldInput ? fieldInput.split(',').map(field => field.trim()).filter(Boolean) : [], expands = expandInput ? expandInput.split(',').map(field => field.trim()).filter(Boolean) : []
  if (fields.length > 50) return { ok: false as const, response: errorResponse(400, '_fields accepts at most 50 fields') }
  if (expands.length > 5) return { ok: false as const, response: errorResponse(400, '_expand accepts at most 5 foreign keys') }
  if (fields.some(field => !resource.fields.includes(field))) return { ok: false as const, response: errorResponse(400, '_fields contains unknown field') }
  if (expands.some(field => !relations.some(relation => relation.child === resource.resource && relation.childField === field))) return { ok: false as const, response: errorResponse(400, '_expand contains a field that is not an enabled foreign key') }
  return { ok: true as const, fields: [...new Set(fields)], expands: [...new Set(expands)] }
}
const shapeRecord = (row: MockRecord, resource: ResourceDefinition, fields: string[], expands: string[]) => {
  const shaped = fields.length ? Object.fromEntries(fields.map(field => [field, structuredClone(row[field])])) : structuredClone(row)
  for (const field of expands) {
    const relation = relations.find(candidate => candidate.child === resource.resource && candidate.childField === field)
    if (!relation) continue
    const parent = db[relation.parent].find(candidate => sameId(candidate[relation.parentField], row[field]))
    shaped[field + '_expanded'] = parent ? structuredClone(parent) : null
  }
  return shaped
}
const filterRows = (rows: MockRecord[], url: URL, resource: ResourceDefinition): FilterResult => {
  const entries: [string, string][] = []
  url.searchParams.forEach((value, key) => entries.push([key, value]))
  if (entries.length > 50) return { ok: false, response: errorResponse(400, 'Query parameter limit is 50') }
  for (const [parameter, expected] of entries) {
    const valueLimit = parameter === '_cursor' ? 4200 : 1000
    if (parameter.length > 120 || expected.length > valueLimit) return { ok: false, response: errorResponse(400, 'Query parameter name or value exceeds limit') }
    if (controlParams.has(parameter)) continue
    const separator = parameter.lastIndexOf('__'), field = separator > 0 ? parameter.slice(0, separator) : parameter, operator = separator > 0 ? parameter.slice(separator + 2) : 'eq'
    if (!resource.fields.includes(field)) continue
    if (!filterOperators.has(operator)) return { ok: false, response: errorResponse(400, 'Unknown filter operator: ' + operator) }
    const definition = resource.validation.find(item => item.name === field), type = definition?.type ?? 'string', lowered = expected.toLocaleLowerCase()
    if (operator === 'in') {
      const candidates = expected.split(',')
      if (candidates.length > 50) return { ok: false, response: errorResponse(400, 'Filter in operator accepts at most 50 values') }
      rows = rows.filter(row => candidates.some(candidate => sameId(row[field], candidate)))
      continue
    }
    if (operator === 'isnull') {
      if (!['true', 'false'].includes(lowered)) return { ok: false, response: errorResponse(400, 'isnull filter must be true or false') }
      rows = rows.filter(row => (row[field] == null) === (lowered === 'true'))
      continue
    }
    if (['contains', 'starts', 'ends'].includes(operator)) {
      rows = rows.filter(row => { const actual = String(row[field] ?? '').toLocaleLowerCase(); return operator === 'contains' ? actual.includes(lowered) : operator === 'starts' ? actual.startsWith(lowered) : actual.endsWith(lowered) })
      continue
    }
    const target = comparable(expected, type)
    if (target === null) return { ok: false, response: errorResponse(400, 'Filter value has invalid type for field: ' + field) }
    rows = rows.filter(row => {
      const actual = comparable(row[field], type)
      if (operator === 'eq' || operator === 'ne') { const equal = actual === target; return operator === 'eq' ? equal : !equal }
      if (actual === null) return false
      return operator === 'gt' ? actual > target : operator === 'gte' ? actual >= target : operator === 'lt' ? actual < target : actual <= target
    })
  }
  return { ok: true, rows }
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

const rowEtag = (row: MockRecord) => {
  const value = JSON.stringify(row)
  return '"mock-' + textFingerprint(value) + '"'
}
const collectionEtag = (resource: ResourceDefinition, url: URL, rawRows: MockRecord[], responseBody: unknown, meta: MockRecord) => {
  const query: [string, string][] = []
  url.searchParams.forEach((value, key) => query.push([key, value]))
  return '"mock-list-' + textFingerprint(JSON.stringify({ resource: resource.resource, query: query.sort(), rawRows, responseBody, meta })) + '"'
}
const notModified = (request: Request, etag: string, headers: Record<string, string> = {}) => {
  const value = request.headers.get('If-None-Match')
  if (value === null) return null
  if (value.length > 512) return errorResponse(400, 'If-None-Match must be under 512 characters')
  const candidates = value.split(',').map(candidate => candidate.trim().replace(/^W\\//, ''))
  return candidates.includes('*') || candidates.includes(etag) ? new Response(null, { status: 304, headers: { ETag: etag, ...headers } }) : null
}
const paginationLinks = (resource: ResourceDefinition, url: URL, page: number, pages: number, cursorRequested: boolean, nextCursor: string | null) => {
  const links: string[] = [], add = (relation: string, key: '_page' | '_cursor', value: string) => {
    const params = new URLSearchParams(url.searchParams)
    params.delete(key === '_page' ? '_cursor' : '_page')
    params.set(key, value)
    links.push('</api/' + encodeURIComponent(resource.resource) + (params.size ? '?' + params.toString() : '') + '>; rel="' + relation + '"')
  }
  if (cursorRequested) { if (nextCursor) add('next', '_cursor', nextCursor); return links.join(', ') }
  add('first', '_page', '1')
  if (page > 1) add('prev', '_page', String(Math.min(page - 1, pages)))
  if (page < pages) add('next', '_page', String(page + 1))
  add('last', '_page', String(pages))
  return links.join(', ')
}
const etagResponse = (row: MockRecord, status = 200) => HttpResponse.json(wrapped(row), { status, headers: { ETag: rowEtag(row) } })
const preconditionResponse = (row: MockRecord, details?: MockRecord) => {
  const currentEtag = rowEtag(row)
  return HttpResponse.json({ error: { status: 412, message: 'ETag precondition failed', currentEtag, ...(details ?? {}) } }, { status: 412, headers: { ETag: currentEtag } })
}
const ifMatchError = (value: unknown, row: MockRecord, details?: MockRecord) => {
  if (value === undefined) return null
  if (typeof value !== 'string' || value.length > 512) return errorResponse(400, 'If-Match must be a valid ETag under 512 characters', details)
  const currentEtag = rowEtag(row), candidates = value.split(',').map(candidate => candidate.trim())
  if (candidates.includes('*') || candidates.includes(currentEtag)) return null
  return preconditionResponse(row, details)
}
const readWithEtag = (request: Request, row: MockRecord, resource: ResourceDefinition) => {
  const shape = responseShape(new URL(request.url), resource)
  if (!shape.ok) return shape.response
  const etag = rowEtag(row), conditional = notModified(request, etag)
  if (conditional) return conditional
  return HttpResponse.json(wrapped(shapeRecord(row, resource, shape.fields, shape.expands)), { headers: { ETag: etag } })
}

const responseFromCache = (response: CachedMockResponse) => {
  const headers = new Headers(response.headers)
  headers.set('X-Mock-Idempotent-Replay', 'true')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
const responseSnapshot = async (response: Response): Promise<CachedMockResponse> => {
  const body = await response.clone().text(), bytes = new TextEncoder().encode(body).byteLength
  const headers: [string, string][] = []
  response.headers.forEach((value, key) => headers.push([key, value]))
  return { status: response.status, statusText: response.statusText, headers, body, bytes }
}
const clearMockIdempotency = () => { const cleared = idempotencyCache.size; idempotencyCache.clear(); idempotencyInFlight.clear(); idempotencyBytes = 0; return cleared }
const retainIdempotentResponse = (key: string, signature: string, response: CachedMockResponse) => {
  if (response.bytes > IDEMPOTENCY_MAX_BYTES) return false
  const existing = idempotencyCache.get(key)
  if (existing) idempotencyBytes -= existing.response.bytes
  idempotencyCache.delete(key)
  idempotencyCache.set(key, { signature, response })
  idempotencyBytes += response.bytes
  while (idempotencyCache.size > IDEMPOTENCY_LIMIT || idempotencyBytes > IDEMPOTENCY_MAX_BYTES) {
    const oldest = idempotencyCache.entries().next().value as [string, { response: CachedMockResponse }] | undefined
    if (!oldest) break
    idempotencyCache.delete(oldest[0]); idempotencyBytes -= oldest[1].response.bytes
  }
  return idempotencyCache.has(key)
}
const idempotencySignature = async (request: Request) => {
  const body = await request.clone().text(), url = new URL(request.url), bytes = new TextEncoder().encode(request.method + '\\n' + url.pathname + url.search + '\\n' + body)
  if (bytes.byteLength > 1024 * 1024) return null
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  }
  let first = 2166136261, second = 2246822519
  for (const value of bytes) { first = Math.imul(first ^ value, 16777619); second = Math.imul(second ^ value, 3266489917) }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0') + ':' + bytes.byteLength
}
const withIdempotency = async (request: Request, resolve: () => Response | Promise<Response>) => {
  const key = request.headers.get('Idempotency-Key')
  if (key === null) return resolve()
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(key)) return errorResponse(400, 'Idempotency-Key must be 1-80 ASCII letters, numbers, ., _, : or -')
  const signature = await idempotencySignature(request)
  if (!signature) return errorResponse(413, 'Idempotent request exceeds 1 MiB')
  const cached = idempotencyCache.get(key)
  if (cached) return cached.signature === signature ? responseFromCache(cached.response) : errorResponse(409, 'Idempotency-Key was already used for a different request')
  const running = idempotencyInFlight.get(key)
  if (running) return running.signature === signature ? responseFromCache(await running.promise) : errorResponse(409, 'Idempotency-Key is in use by a different request')
  let original: Response
  const promise = (async () => { original = await resolve(); return responseSnapshot(original) })()
  idempotencyInFlight.set(key, { signature, promise })
  try {
    const snapshot = await promise, stored = retainIdempotentResponse(key, signature, snapshot)
    original!.headers.set('X-Mock-Idempotency-Stored', String(stored))
    return original!
  } finally { idempotencyInFlight.delete(key) }
}

const validateBody = (body: MockRecord, resource: ResourceDefinition, partial: boolean): ValidationIssue | null => {
  if (!mockApiOptions.validateSchema) return null
  const unknown = Object.keys(body).find(field => !resource.fields.includes(field))
  if (unknown) return { field: unknown, rule: 'unknown_field', message: 'Unknown field: ' + unknown }
  if (partial && Object.prototype.hasOwnProperty.call(body, resource.key)) return { field: resource.key, rule: 'immutable', message: 'Primary key cannot be changed' }
  for (const field of resource.validation) {
    const value = body[field.name]
    if (value === undefined) {
      if (!partial && field.required) return { field: field.name, rule: 'required', message: 'Required field missing: ' + field.name }
      continue
    }
    if (value === null) {
      if (!field.nullable) return { field: field.name, rule: 'nullable', message: 'Field cannot be null: ' + field.name }
      continue
    }
    const validType = field.type === 'object'
      ? typeof value === 'object' && !Array.isArray(value)
      : field.type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === field.type
    if (!validType) return { field: field.name, rule: 'type', message: 'Invalid type for field: ' + field.name }
    if (field.values && !field.values.some(candidate => Object.is(candidate, value))) return { field: field.name, rule: 'enum', message: 'Invalid enum value for field: ' + field.name }
    if (typeof value === 'number' && field.min !== undefined && value < field.min) return { field: field.name, rule: 'minimum', message: 'Field is below minimum: ' + field.name }
    if (typeof value === 'number' && field.max !== undefined && value > field.max) return { field: field.name, rule: 'maximum', message: 'Field is above maximum: ' + field.name }
    if (typeof value === 'string' && field.maxLength !== undefined && Array.from(value).length > field.maxLength) return { field: field.name, rule: 'max_length', message: 'Field is too long: ' + field.name }
  }
  return null
}
const validateReplacementBody = (body: MockRecord, resource: ResourceDefinition): ValidationIssue | null => {
  const missing = resource.validation.find(field => field.required && body[field.name] === undefined)
  if (missing) return { field: missing.name, rule: 'required', message: 'Required field missing: ' + missing.name }
  return validateBody(body, resource, false)
}

const invalidReference = (body: MockRecord, resource: ResourceDefinition) => {
  if (!mockApiOptions.validateForeignKeys) return null
  for (const relation of relations) {
    if (relation.child !== resource.resource || body[relation.childField] == null) continue
    const exists = db[relation.parent].some(row => sameId(row[relation.parentField], body[relation.childField]))
    if (!exists) return relation
  }
  return null
}
const duplicateUniqueField = (body: MockRecord, resource: ResourceDefinition, exclude?: MockRecord) => resource.uniqueFields.find(field =>
  body[field] != null && db[resource.resource].some(row => row !== exclude && row[field] != null && sameId(row[field], body[field])),
)
type InsertResult = { ok: true; row: MockRecord } | { ok: false; status: number; message: string; details?: MockRecord }
const insertRecord = (input: MockRecord, resource: ResourceDefinition): InsertResult => {
  const issue = validateBody(input, resource, false)
  if (issue) return { ok: false, status: 422, message: issue.message, details: issue }
  const body = allowedBody(input, resource)
  if (body[resource.key] == null) {
    body[resource.key] = resource.numericKey
      ? Math.max(0, ...db[resource.resource].map(item => Number(item[resource.key]) || 0)) + 1
      : crypto.randomUUID()
  }
  if (db[resource.resource].some(item => sameId(item[resource.key], body[resource.key]))) {
    return { ok: false, status: 409, message: 'Primary key already exists' }
  }
  const duplicate = duplicateUniqueField(body, resource)
  if (duplicate) return { ok: false, status: 409, message: 'Unique field already exists: ' + duplicate, details: { field: duplicate, rule: 'unique' } }
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

const validSnapshotName = (name: string) => /^[A-Za-z0-9一-龥_-]{1,40}$/.test(name)
const snapshotRows = (database: MockDatabase) => Object.fromEntries(resources.map(resource => [resource.resource, database[resource.resource].length]))
export const listMockSnapshots = () => [...snapshotStore.values()].map(item => structuredClone(item.summary)).sort((left, right) => right.revision - left.revision)
export const saveMockSnapshot = (input: string): SnapshotResult => {
  const name = input.trim(), replaced = snapshotStore.has(name)
  if (!validSnapshotName(name)) return { ok: false, status: 400, message: 'Snapshot name must be 1-40 Chinese letters, ASCII letters, numbers, _ or -' }
  if (!replaced && snapshotStore.size >= SNAPSHOT_LIMIT) return { ok: false, status: 409, message: 'Snapshot limit is 10' }
  const serialized = JSON.stringify(db), bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes > SNAPSHOT_MAX_BYTES) return { ok: false, status: 413, message: 'Snapshot exceeds 5 MiB' }
  const database = JSON.parse(serialized) as MockDatabase
  const rows = snapshotRows(database), summary = { name, revision: ++snapshotRevision, bytes, totalRows: Object.values(rows).reduce((sum, count) => sum + count, 0), rows }
  snapshotStore.set(name, { summary, database })
  return { ok: true, snapshot: structuredClone(summary), replaced }
}
export const restoreMockSnapshot = (input: string) => {
  const snapshot = snapshotStore.get(input.trim())
  if (!snapshot) return null
  for (const resource of resources) db[resource.resource] = structuredClone(snapshot.database[resource.resource])
  return structuredClone(snapshot.summary)
}
export const deleteMockSnapshot = (input: string) => snapshotStore.delete(input.trim())
export const clearMockSnapshots = () => { const cleared = snapshotStore.size; snapshotStore.clear(); snapshotRevision = 0; return cleared }
const transactionAliasPattern = /^[A-Za-z][A-Za-z0-9_]{0,29}$/
const transactionReferencePattern = /^\\$([A-Za-z][A-Za-z0-9_]{0,29})\\.([^.$\\s]{1,80})$/
const resolveTransactionValue = (value: unknown, aliases: Map<string, MockRecord>, depth = 0): ResolvedValue => {
  if (depth > 10) return { ok: false, message: 'Transaction value nesting exceeds 10 levels' }
  if (typeof value === 'string') {
    const reference = value.match(transactionReferencePattern)
    if (!reference) return { ok: true, value }
    const row = aliases.get(reference[1])
    if (!row) return { ok: false, message: 'Unknown or forward alias: ' + reference[1] }
    if (!Object.prototype.hasOwnProperty.call(row, reference[2])) return { ok: false, message: 'Alias field not found: ' + reference[1] + '.' + reference[2] }
    return { ok: true, value: structuredClone(row[reference[2]]) }
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (const item of value) { const resolved = resolveTransactionValue(item, aliases, depth + 1); if (!resolved.ok) return resolved; result.push(resolved.value) }
    return { ok: true, value: result }
  }
  const record = asRecord(value)
  if (record) {
    const result: MockRecord = Object.create(null) as MockRecord
    for (const [field, item] of Object.entries(record)) { const resolved = resolveTransactionValue(item, aliases, depth + 1); if (!resolved.ok) return resolved; result[field] = resolved.value }
    return { ok: true, value: result }
  }
  return { ok: true, value }
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
  const sequence = ++requestSequence, requestId = 'mock-' + mockApiOptions.seed + '-' + String(sequence).padStart(6, '0')
  const span = scenario.latencyMaxMs - scenario.latencyMinMs
  const latency = scenario.latencyMinMs + Math.floor((span + 1) * latencyRoll)
  const finalize = (response: Response, injectedFailure: boolean) => {
    const routeOverride = 'path' in scenario ? scenario.method + ' ' + scenario.path : undefined
    response.headers.set('X-Mock-Request-Id', requestId)
    response.headers.set('X-Mock-Latency', String(latency))
    if (injectedFailure) response.headers.set('X-Mock-Injected-Failure', 'true')
    if (routeOverride) response.headers.set('X-Mock-Route-Override', routeOverride)
    const pathname = new URL(request.url).pathname
    recordExpectations(request.method, pathname, response.status)
    requestLog.push({ id: requestId, sequence, method: request.method, path: pathname, status: response.status, latencyMs: latency, injectedFailure, idempotentReplay: response.headers.get('X-Mock-Idempotent-Replay') === 'true', ...(routeOverride ? { routeOverride } : {}) })
    if (requestLog.length > 500) requestLog.splice(0, requestLog.length - 500)
    return response
  }
  if (latency > 0) await new Promise(done => setTimeout(done, latency))
  if (failureRoll * 100 < scenario.failureRate) {
    const response = errorResponse(scenario.failureStatus, 'failureMessage' in scenario ? scenario.failureMessage : 'Injected mock network failure')
    return finalize(response, true)
  }
  return finalize(await resolve(), false)
}

export const resetMockData = () => {
  for (const resource of resources) db[resource.resource] = structuredClone(initialDb[resource.resource])
  requestCounts.clear()
  requestLog.length = 0
  requestSequence = 0
  clearMockSnapshots()
  clearMockIdempotency()
  clearMockExpectations()
}

export const handlers = resources.flatMap(resource => [
  http.get('*/api/' + resource.resource, ({ request }) => withNetwork(request, () => {
    const url = new URL(request.url)
    const shape = responseShape(url, resource)
    if (!shape.ok) return shape.response
    const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase()
    let rows = [...db[resource.resource]]
    const filtered = filterRows(rows, url, resource)
    if (!filtered.ok) return filtered.response
    rows = filtered.rows
    if (query) {
      rows = rows.filter(row =>
        Object.values(row).some(value => String(value ?? '').toLocaleLowerCase().includes(query)),
      )
    }
    const sortInput = url.searchParams.get('_sort'), cursorRequested = url.searchParams.has('_cursor'), cursorInput = url.searchParams.get('_cursor'), fallbackOrder = url.searchParams.get('_order') === 'desc' ? -1 : 1
    if (cursorRequested && url.searchParams.has('_page')) return errorResponse(400, '_cursor and _page cannot be combined')
    const requestedSorts = sortInput ? sortInput.split(',').filter(Boolean) : cursorRequested ? [resource.key] : []
    if (requestedSorts.length > 5) return errorResponse(400, 'Sort field limit is 5')
    if (requestedSorts.some(sort => !resource.fields.includes(sort.replace(/^-/, '')))) return errorResponse(400, 'Unknown sort field')
    const sorts = [...requestedSorts]
    if (cursorRequested && !sorts.some(sort => sort.replace(/^-/, '') === resource.key)) sorts.push(resource.key)
    const compareTuple = (row: MockRecord, values: unknown[]) => {
      for (let index = 0; index < sorts.length; index++) {
        const sort = sorts[index], descending = sort.startsWith('-'), field = sort.replace(/^-/, ''), definition = resource.validation.find(item => item.name === field), actual = comparable(row[field], definition?.type ?? 'string'), expected = comparable(values[index], definition?.type ?? 'string')
        const compared = actual === expected ? 0 : actual == null ? -1 : expected == null ? 1 : actual < expected ? -1 : 1
        if (compared) return compared * (descending ? -1 : requestedSorts.length === 1 ? fallbackOrder : 1)
      }
      return 0
    }
    if (sorts.length) rows.sort((left, right) => compareTuple(left, sorts.map(sort => right[sort.replace(/^-/, '')])))
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('_limit')) || 20))
    const total = rows.length
    if (cursorRequested && cursorInput !== 'start') {
      const cursor = decodeCursor(cursorInput ?? ''), queryFingerprint = cursorQueryFingerprint(url), sortKey = sorts.join(',')
      if (!cursor || cursor.version !== 1 || cursor.resource !== resource.resource || cursor.query !== queryFingerprint || cursor.sort !== sortKey || !Array.isArray(cursor.values) || cursor.values.length !== sorts.length) return errorResponse(400, 'Cursor is invalid, expired or belongs to a different query')
      rows = rows.filter(row => compareTuple(row, cursor.values as unknown[]) > 0)
    }
    const page = Math.max(1, Number(url.searchParams.get('_page')) || 1), start = cursorRequested ? 0 : (page - 1) * limit, rawPageRows = rows.slice(start, start + limit), hasMore = rows.length > start + limit
    const nextCursor = cursorRequested && hasMore && rawPageRows.length ? encodeCursor({ version: 1, resource: resource.resource, query: cursorQueryFingerprint(url), sort: sorts.join(','), values: sorts.map(sort => rawPageRows.at(-1)![sort.replace(/^-/, '')]) }) : null, pageRows = rawPageRows.map(row => shapeRecord(row, resource, shape.fields, shape.expands)), meta = { ...(cursorRequested ? { nextCursor, hasMore } : { page }), limit, total }, responseBody = wrapped(pageRows, meta), etag = collectionEtag(resource, url, rawPageRows, responseBody, meta), link = paginationLinks(resource, url, page, Math.max(1, Math.ceil(total / limit)), cursorRequested, nextCursor), responseHeaders = { 'X-Total-Count': String(total), ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}), ...(link ? { Link: link } : {}) }, conditional = notModified(request, etag, responseHeaders)
    if (conditional) return conditional
    return HttpResponse.json(responseBody, { headers: { ETag: etag, ...responseHeaders } })
  })),
  http.get('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, () => {
    const row = db[resource.resource].find(item => sameId(item[resource.key], params.id))
    return row ? readWithEtag(request, row, resource) : errorResponse(404, 'Not found')
  })),
  http.post('*/api/' + resource.resource, ({ request }) => withNetwork(request, () => withIdempotency(request, async () => {
    const input = await jsonBody(request)
    if (!input) return errorResponse(400, 'JSON object required')
    const result = insertRecord(input, resource)
    return result.ok ? etagResponse(result.row, 201) : errorResponse(result.status, result.message, result.details)
  }))),
  http.put('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, async () => {
    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id))
    const input = await jsonBody(request)
    if (index < 0) return errorResponse(404, 'Not found')
    if (!input) return errorResponse(400, 'JSON object required')
    const current = db[resource.resource][index], precondition = ifMatchError(request.headers.get('If-Match') ?? undefined, current)
    if (precondition) return precondition
    if (Object.prototype.hasOwnProperty.call(input, resource.key) && !sameId(input[resource.key], current[resource.key])) return errorResponse(422, 'Primary key cannot be changed', { field: resource.key, rule: 'immutable' })
    const issue = validateReplacementBody(input, resource)
    if (issue) return errorResponse(422, issue.message, issue)
    const candidate = { ...allowedBody(input, resource), [resource.key]: current[resource.key] }
    const duplicate = duplicateUniqueField(candidate, resource, current)
    if (duplicate) return errorResponse(409, 'Unique field already exists: ' + duplicate, { field: duplicate, rule: 'unique' })
    const invalid = invalidReference(candidate, resource)
    if (invalid) return errorResponse(422, 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField)
    db[resource.resource][index] = candidate
    return etagResponse(candidate)
  })),
  http.patch('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, async () => {
    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id))
    const input = await jsonBody(request)
    if (index < 0) return errorResponse(404, 'Not found')
    if (!input) return errorResponse(400, 'JSON object required')
    const precondition = ifMatchError(request.headers.get('If-Match') ?? undefined, db[resource.resource][index])
    if (precondition) return precondition
    const issue = validateBody(input, resource, true)
    if (issue) return errorResponse(422, issue.message, issue)
    const body = allowedBody(input, resource)
    const candidate = { ...db[resource.resource][index], ...body }
    const duplicate = duplicateUniqueField(candidate, resource, db[resource.resource][index])
    if (duplicate) return errorResponse(409, 'Unique field already exists: ' + duplicate, { field: duplicate, rule: 'unique' })
    const invalid = invalidReference(candidate, resource)
    if (invalid) return errorResponse(422, 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField)
    db[resource.resource][index] = {
      ...db[resource.resource][index],
      ...body,
      [resource.key]: db[resource.resource][index][resource.key],
    }
    return etagResponse(db[resource.resource][index])
  })),
  http.delete('*/api/' + resource.resource + '/:id', ({ params, request }) => withNetwork(request, () => {
    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id))
    if (index < 0) return errorResponse(404, 'Not found')
    const precondition = ifMatchError(request.headers.get('If-Match') ?? undefined, db[resource.resource][index])
    if (precondition) return precondition
    const dependents = dependentRows(resource, db[resource.resource][index])
    if (dependents.length && mockApiOptions.deletePolicy === 'restrict') {
      return errorResponse(409, 'Referenced by ' + dependents.length + ' child record(s)')
    }
    if (dependents.length) cascadeDependents(resource, db[resource.resource][index])
    const [deleted] = db[resource.resource].splice(index, 1)
    return etagResponse(deleted)
  })),
])

const batchHandlers = resources.flatMap(resource => [
  http.post('*/api/' + resource.resource + '/_batch', ({ request }) => withNetwork(request, () => withIdempotency(request, async () => {
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
        return errorResponse(result.status, result.message, { index, ...(result.details ?? {}) })
      }
      created.push(result.row)
    }
    return HttpResponse.json(wrapped(created, { created: created.length }), { status: 201 })
  }))),
  http.patch('*/api/' + resource.resource + '/_batch', ({ request }) => withNetwork(request, async () => {
    const payload = await requestJson(request), values = Array.isArray(payload) ? payload : asRecord(payload)?.items
    if (!Array.isArray(values) || values.length === 0) return errorResponse(400, 'Non-empty items array required')
    if (values.length > 1000) return errorResponse(400, 'Batch limit is 1000 records')
    const snapshot = structuredClone(db[resource.resource]), updated: MockRecord[] = [], seen = new Set<string>()
    for (let index = 0; index < values.length; index++) {
      const input = asRecord(values[index]), changes = asRecord(input?.changes), id = input?.id
      if (!input || id == null || !changes || Object.keys(input).some(field => !['id', 'changes', 'ifMatch'].includes(field))) {
        db[resource.resource] = snapshot
        return errorResponse(400, 'Each item requires only id and changes', { index })
      }
      const identity = String(id)
      if (seen.has(identity)) {
        db[resource.resource] = snapshot
        return errorResponse(409, 'Duplicate id in batch', { index })
      }
      seen.add(identity)
      const rowIndex = db[resource.resource].findIndex(item => sameId(item[resource.key], id))
      if (rowIndex < 0) {
        db[resource.resource] = snapshot
        return errorResponse(404, 'Record not found', { index })
      }
      const precondition = ifMatchError(Object.prototype.hasOwnProperty.call(input, 'ifMatch') ? input.ifMatch : undefined, db[resource.resource][rowIndex], { index })
      if (precondition) { db[resource.resource] = snapshot; return precondition }
      const issue = validateBody(changes, resource, true)
      if (issue) {
        db[resource.resource] = snapshot
        return errorResponse(422, issue.message, { index, ...issue })
      }
      const body = allowedBody(changes, resource), candidate = { ...db[resource.resource][rowIndex], ...body, [resource.key]: db[resource.resource][rowIndex][resource.key] }
      const duplicate = duplicateUniqueField(candidate, resource, db[resource.resource][rowIndex])
      if (duplicate) {
        db[resource.resource] = snapshot
        return errorResponse(409, 'Unique field already exists: ' + duplicate, { index, field: duplicate, rule: 'unique' })
      }
      const invalid = invalidReference(candidate, resource)
      if (invalid) {
        db[resource.resource] = snapshot
        return errorResponse(422, 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField, { index })
      }
      db[resource.resource][rowIndex] = candidate
      updated.push(candidate)
    }
    return HttpResponse.json(wrapped(updated, { updated: updated.length }))
  })),
  http.delete('*/api/' + resource.resource + '/_batch', ({ request }) => withNetwork(request, async () => {
    const payload = await requestJson(request), root = asRecord(payload), values = Array.isArray(payload) ? payload : Array.isArray(root?.items) ? root.items : root?.ids
    if (!Array.isArray(values) || values.length === 0) return errorResponse(400, 'Non-empty ids or items array required')
    if (values.length > 1000) return errorResponse(400, 'Batch limit is 1000 records')
    const databaseSnapshot = structuredClone(db), targets: MockRecord[] = [], seen = new Set<string>()
    for (let index = 0; index < values.length; index++) {
      const item = asRecord(values[index]), id = item ? item.id : values[index]
      if (item && (id == null || Object.keys(item).some(field => !['id', 'ifMatch'].includes(field)))) return errorResponse(400, 'Each delete item requires only id and optional ifMatch', { index })
      if (!['string', 'number'].includes(typeof id)) return errorResponse(400, 'Each id must be a string or number', { index })
      const identity = String(id)
      if (seen.has(identity)) return errorResponse(409, 'Duplicate id in batch', { index })
      seen.add(identity)
      const row = db[resource.resource].find(item => sameId(item[resource.key], id))
      if (!row) return errorResponse(404, 'Record not found', { index })
      const precondition = ifMatchError(item && Object.prototype.hasOwnProperty.call(item, 'ifMatch') ? item.ifMatch : undefined, row, { index })
      if (precondition) return precondition
      if (mockApiOptions.deletePolicy === 'restrict') {
        const dependents = dependentRows(resource, row)
        if (dependents.length) return errorResponse(409, 'Referenced by ' + dependents.length + ' child record(s)', { index })
      }
      targets.push(structuredClone(row))
    }
    const beforeRows = Object.values(db).reduce((sum, rows) => sum + rows.length, 0)
    try {
      for (const target of targets) {
        const current = db[resource.resource].find(item => sameId(item[resource.key], target[resource.key]))
        if (!current) continue
        if (mockApiOptions.deletePolicy === 'cascade') cascadeDependents(resource, current)
        db[resource.resource] = db[resource.resource].filter(item => item !== current)
      }
    } catch (error) {
      for (const definition of resources) db[definition.resource] = databaseSnapshot[definition.resource]
      return errorResponse(500, error instanceof Error ? error.message : 'Batch delete failed')
    }
    const afterRows = Object.values(db).reduce((sum, rows) => sum + rows.length, 0)
    return HttpResponse.json(wrapped(targets, { deleted: targets.length, cascaded: Math.max(0, beforeRows - afterRows - targets.length) }))
  })),
])

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
  requests: requestLog.length,
  snapshots: snapshotStore.size,
  idempotency: idempotencyCache.size,
  expectations: mockExpectations.length,
  rows: Object.fromEntries(resources.map(resource => [resource.resource, db[resource.resource].length])),
})
const controlHandlers = [
  http.get('*/api/__mock/health', () => HttpResponse.json(wrapped(databaseSummary()))),
  http.post('*/api/__mock/reset', () => {
    resetMockData()
    return HttpResponse.json(wrapped(databaseSummary()))
  }),
  http.get('*/api/__mock/requests', ({ request }) => {
    const url = new URL(request.url), method = url.searchParams.get('method')?.toUpperCase(), statusValue = url.searchParams.get('status'), status = statusValue && /^\\d{3}$/.test(statusValue) ? Number(statusValue) : undefined, limit = Math.max(1, Math.min(500, Number(url.searchParams.get('_limit')) || 100))
    const rows = requestLog.filter(item => (!method || item.method === method) && (!Number.isFinite(status) || item.status === status)).slice(-limit).reverse()
    return HttpResponse.json(wrapped(rows, { total: rows.length, retained: requestLog.length }))
  }),
  http.delete('*/api/__mock/requests', () => {
    requestLog.length = 0
    return HttpResponse.json(wrapped({ cleared: true }))
  }),
  http.delete('*/api/__mock/idempotency', () => HttpResponse.json(wrapped({ cleared: clearMockIdempotency() }))),
  http.get('*/api/__mock/expectations', () => {
    const rows = mockExpectations.map(expectationView), passed = rows.filter(row => row.outcome === 'passed').length, failed = rows.filter(row => row.outcome === 'failed').length
    return HttpResponse.json(wrapped(rows, { total: rows.length, passed, pending: rows.length - passed - failed, failed, limit: EXPECTATION_LIMIT }))
  }),
  http.post('*/api/__mock/expectations', async ({ request }) => {
    const result = addMockExpectation(await requestJson(request))
    return result.ok ? HttpResponse.json(wrapped(result.expectation), { status: 201 }) : errorResponse(result.status, result.message)
  }),
  http.delete('*/api/__mock/expectations', () => HttpResponse.json(wrapped({ cleared: clearMockExpectations() }))),
  http.post('*/api/__mock/expectations/reset', () => HttpResponse.json(wrapped({ reset: resetMockExpectationCounts() }))),
  http.get('*/api/__mock/expectations/verify', () => {
    const rows = mockExpectations.map(expectationView), passed = rows.filter(row => row.outcome === 'passed').length, failed = rows.filter(row => row.outcome === 'failed').length, pending = rows.length - passed - failed, ok = failed === 0 && pending === 0
    return HttpResponse.json(wrapped({ ok, total: rows.length, passed, pending, failed, expectations: rows }), { status: ok ? 200 : 409 })
  }),
  http.delete('*/api/__mock/expectations/:id', ({ params }) => {
    const index = mockExpectations.findIndex(expectation => expectation.id === params.id)
    if (index < 0) return errorResponse(404, 'Expectation not found')
    const [deleted] = mockExpectations.splice(index, 1)
    return HttpResponse.json(wrapped(expectationView(deleted)))
  }),
  http.get('*/api/__mock/snapshots', () => {
    const rows = listMockSnapshots()
    return HttpResponse.json(wrapped(rows, { total: rows.length, limit: SNAPSHOT_LIMIT }))
  }),
  http.post('*/api/__mock/snapshots', async ({ request }) => {
    const body = asRecord(await requestJson(request))
    if (!body || Object.keys(body).some(field => field !== 'name')) return errorResponse(400, 'JSON object with only name is required')
    const result = saveMockSnapshot(typeof body.name === 'string' ? body.name : '')
    if (!result.ok) return errorResponse(result.status, result.message)
    return HttpResponse.json(wrapped(result.snapshot, { replaced: result.replaced }), { status: result.replaced ? 200 : 201 })
  }),
  http.delete('*/api/__mock/snapshots', () => HttpResponse.json(wrapped({ cleared: clearMockSnapshots() }))),
  http.post('*/api/__mock/snapshots/:name/restore', ({ params }) => {
    const snapshot = restoreMockSnapshot(String(params.name ?? ''))
    return snapshot ? HttpResponse.json(wrapped(snapshot)) : errorResponse(404, 'Snapshot not found')
  }),
  http.delete('*/api/__mock/snapshots/:name', ({ params }) => {
    const deleted = deleteMockSnapshot(String(params.name ?? ''))
    return deleted ? HttpResponse.json(wrapped({ deleted: true })) : errorResponse(404, 'Snapshot not found')
  }),
  http.post('*/api/__mock/transactions', ({ request }) => withIdempotency(request, async () => {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > TRANSACTION_MAX_BYTES) return errorResponse(413, 'Transaction exceeds 1 MiB')
    let payload: unknown
    try { payload = JSON.parse(text) } catch { return errorResponse(400, 'Valid JSON transaction required') }
    const root = asRecord(payload), actions = Array.isArray(payload) ? payload : root?.actions
    if (!Array.isArray(actions) || actions.length === 0) return errorResponse(400, 'Non-empty actions array required')
    if (actions.length > TRANSACTION_LIMIT) return errorResponse(400, 'Transaction limit is 100 actions')
    if (root && Object.keys(root).some(field => field !== 'actions')) return errorResponse(400, 'Transaction object only accepts actions')
    const databaseSnapshot = structuredClone(db), aliases = new Map<string, MockRecord>(), results: Array<{ index: number; op: string; resource: string; row: MockRecord; etag: string; alias?: string }> = []
    const rollback = (status: number, message: string, index: number, details?: MockRecord) => {
      for (const definition of resources) db[definition.resource] = databaseSnapshot[definition.resource]
      return errorResponse(status, message, { index, ...(details ?? {}) })
    }
    let activeIndex = 0
    try { for (let index = 0; index < actions.length; index++) {
      activeIndex = index
      const action = asRecord(actions[index]), op = action?.op, resourceName = action?.resource, alias = action?.as
      if (!action || !['create', 'update', 'delete'].includes(String(op)) || typeof resourceName !== 'string') return rollback(400, 'Each action requires op and resource', index)
      const allowed = op === 'create' ? ['op', 'resource', 'body', 'as'] : op === 'update' ? ['op', 'resource', 'id', 'changes', 'ifMatch', 'as'] : ['op', 'resource', 'id', 'ifMatch', 'as']
      if (Object.keys(action).some(field => !allowed.includes(field))) return rollback(400, 'Unexpected transaction action field', index)
      const resource = resourceByName.get(resourceName)
      if (!resource) return rollback(400, 'Unknown resource: ' + resourceName, index)
      if (alias !== undefined && (typeof alias !== 'string' || !transactionAliasPattern.test(alias))) return rollback(400, 'Alias must start with a letter and contain at most 30 ASCII letters, numbers or _', index)
      if (typeof alias === 'string' && aliases.has(alias)) return rollback(409, 'Duplicate transaction alias: ' + alias, index)
      let row: MockRecord
      if (op === 'create') {
        const resolved = resolveTransactionValue(action.body, aliases), body = resolved.ok ? asRecord(resolved.value) : null
        if (!resolved.ok) return rollback(400, resolved.message, index)
        if (!body) return rollback(400, 'Create action requires body object', index)
        const inserted = insertRecord(body, resource)
        if (!inserted.ok) return rollback(inserted.status, inserted.message, index, inserted.details)
        row = inserted.row
      } else {
        const resolvedId = resolveTransactionValue(action.id, aliases)
        if (!resolvedId.ok) return rollback(400, resolvedId.message, index)
        if (!['string', 'number'].includes(typeof resolvedId.value)) return rollback(400, 'Update/delete action requires string or number id', index)
        const rowIndex = db[resource.resource].findIndex(item => sameId(item[resource.key], resolvedId.value))
        if (rowIndex < 0) return rollback(404, 'Record not found', index)
        const precondition = ifMatchError(Object.prototype.hasOwnProperty.call(action, 'ifMatch') ? action.ifMatch : undefined, db[resource.resource][rowIndex], { index })
        if (precondition) {
          for (const definition of resources) db[definition.resource] = databaseSnapshot[definition.resource]
          if (precondition.status === 412) {
            const restored = db[resource.resource].find(item => sameId(item[resource.key], resolvedId.value))
            if (restored) return preconditionResponse(restored, { index })
          }
          return precondition
        }
        if (op === 'update') {
          const resolved = resolveTransactionValue(action.changes, aliases), changes = resolved.ok ? asRecord(resolved.value) : null
          if (!resolved.ok) return rollback(400, resolved.message, index)
          if (!changes) return rollback(400, 'Update action requires changes object', index)
          const issue = validateBody(changes, resource, true)
          if (issue) return rollback(422, issue.message, index, issue)
          const candidate = { ...db[resource.resource][rowIndex], ...allowedBody(changes, resource), [resource.key]: db[resource.resource][rowIndex][resource.key] }
          const duplicate = duplicateUniqueField(candidate, resource, db[resource.resource][rowIndex])
          if (duplicate) return rollback(409, 'Unique field already exists: ' + duplicate, index, { field: duplicate, rule: 'unique' })
          const invalid = invalidReference(candidate, resource)
          if (invalid) return rollback(422, 'Foreign key not found: ' + invalid.childField + ' -> ' + invalid.parent + '.' + invalid.parentField, index)
          db[resource.resource][rowIndex] = candidate
          row = candidate
        } else {
          const dependents = dependentRows(resource, db[resource.resource][rowIndex])
          if (dependents.length && mockApiOptions.deletePolicy === 'restrict') return rollback(409, 'Referenced by ' + dependents.length + ' child record(s)', index)
          if (dependents.length) cascadeDependents(resource, db[resource.resource][rowIndex])
          ;[row] = db[resource.resource].splice(rowIndex, 1)
        }
      }
      if (typeof alias === 'string') aliases.set(alias, structuredClone(row))
      results.push({ index, op: String(op), resource: resourceName, row: structuredClone(row), etag: rowEtag(row), ...(typeof alias === 'string' ? { alias } : {}) })
    } } catch (error) { return rollback(500, error instanceof Error ? error.message : 'Transaction failed', activeIndex) }
    return HttpResponse.json(wrapped(results, { actions: results.length, aliases: [...aliases.keys()] }))
  })),
]

handlers.unshift(...controlHandlers, ...batchHandlers)
handlers.push(...relationHandlers)
`
}

export function mockApiReadme(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const routes=mockApiRoutes(project,options),behavior=normalizeMockApiOptionsForProject(project,options)
  const nested=routes.flatMap(route=>route.nested)
  return`# ${project.name} Mock API

此包由竹小冉mock造数生成。数据已固定为 seed ${project.seed}、时间基准 ${project.referenceDate??'2026-08-14T00:00:00.000Z'}，不需要连接服务器或数据库。它只在使用者自己的浏览器或测试进程内运行，不会在竹小冉mock造数公共站点创建可写接口。

## 当前网络场景

- 延迟：${behavior.latencyMinMs}–${behavior.latencyMaxMs} ms
- 失败率：${behavior.failureRate}%（HTTP ${behavior.failureStatus}）
- 成功响应：${behavior.envelope==='plain'?'原始 JSON':behavior.envelope==='data'?'\`{ data }\`':'\`{ data, meta }\`'}
- Schema 严格校验：${behavior.validateSchema?'开启，类型、必填、枚举、范围、长度和未知字段不合法时返回 HTTP 422':'关闭，未知字段按兼容模式静默丢弃'}
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

包内测试会真实启动 MSW Node server，验证分页、CRUD、PUT 完整替换、ETag 乐观锁、原子批量增改删、跨表事务、控制接口、复位、外键、删除策略和嵌套路由。

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

${routes.map(route=>`- \`GET ${route.list}?_page=1&_limit=20&_sort=-${route.primaryKey}&q=关键字\`
- \`GET ${route.list}?_cursor=start&_limit=20&_sort=-${route.primaryKey}\`（后续传响应头 \`X-Next-Cursor\`）
- \`GET ${route.list}?_fields=${route.filters.slice(0,2).join(',')}\`（只返回指定字段）
- \`GET ${route.list}?字段名=精确值\`
- \`GET ${route.list}?price__gte=100&status__in=成功,失败&name__contains=耳机\`
- \`GET ${route.detail}\`
- \`POST ${route.list}\`
- \`PUT ${route.detail}\`（完整替换；可发送 \`If-Match\`）
- \`POST ${route.batch}\`（1–1,000 条，失败整批回滚）
- \`PATCH ${route.batch}\`（\`[{ id, changes, ifMatch? }]\`，失败整批回滚）
- \`DELETE ${route.batch}\`（ID 数组、\`{ ids: [] }\` 或 \`{ items: [{ id, ifMatch }] }\`）
- \`PATCH ${route.detail}\`（可发送 \`If-Match\`）
- \`DELETE ${route.detail}\`（可发送 \`If-Match\`）`).join('\n')}

### 控制接口

- \`GET /api/__mock/health\`：返回 seed、数据表数量及各表当前行数。
- \`POST /api/__mock/reset\`：恢复全部初始数据并清空网络序列、请求轨迹和场景快照。
- \`GET /api/__mock/requests?_limit=100&method=POST&status=429\`：倒序查询最近请求，可按方法和状态筛选。
- \`DELETE /api/__mock/requests\`：只清空请求轨迹，不改变业务数据。
- \`GET /api/__mock/snapshots\`：列出当前场景快照。
- \`POST /api/__mock/snapshots\`：以 \`{ "name": "before-refund" }\` 保存整库；同名时安全覆盖。
- \`POST /api/__mock/snapshots/:name/restore\`：将全部业务表恢复到快照状态。
- \`DELETE /api/__mock/snapshots/:name\`：删除单个快照；\`DELETE /api/__mock/snapshots\` 清空全部快照。
- \`POST /api/__mock/transactions\`：原子执行最多 100 步跨表 JSON 动作，支持 \`create/update/delete\` 与 \`$alias.field\` 引用。
- \`DELETE /api/__mock/idempotency\`：只清空本地幂等响应缓存，不改变业务数据和请求轨迹。
- \`POST /api/__mock/expectations\`：声明业务接口的最少/最多调用次数和允许状态码，只接受当前 Schema 的路由。
- \`GET /api/__mock/expectations/verify\`：全部满足返回 200；漏调、超调或状态码不符返回 409。
- \`GET /api/__mock/expectations\`：查看逐条结果；\`POST .../reset\` 重置计数；DELETE 支持单删或全清。

控制接口不经过延迟和失败注入，确保极端故障场景下仍能检查与复位；它们只存在于本地 MSW 内存环境，不是远程管理接口。事务只解释受限 JSON，不执行 JavaScript、不请求外部 URL，限制 100 步、1 MiB 和 10 层值嵌套；任一步失败恢复整个数据库。接口调用预期最多 100 条，方法和路径必须来自当前生成的业务路由，次数上限 10,000、允许状态码最多 20 个；只统计业务响应，不读取请求体。快照最多 10 个、每个最多 5 MiB，名称只允许 1–40 个中英文、数字、下划线或连字符；\`resetMockData()\` 会一并清除快照、幂等缓存和调用预期，保证测试隔离。请求轨迹最多保留 500 条，仅记录序号、方法、pathname、状态、延迟、故障标记、幂等重放标记和命中规则；不会记录查询参数、请求体、Idempotency-Key、Authorization、Cookie 或其他 header。

${nested.length?`### 父子嵌套查询\n\n${nested.map(route=>`- \`GET ${route.path}\`（${route.parent} → ${route.child}.${route.foreignKey}）`).join('\n')}\n`:''}

列表同时支持原页码分页和游标分页：传 \`_cursor=start\` 获取第一页，后续传 \`X-Next-Cursor\` 或标准 \`Link\` 响应头中的 \`rel="next"\`；游标绑定资源、筛选、排序、响应形态和当前进程随机密钥，篡改、跨查询复用或与 \`_page\` 混用返回 400。页码模式的 \`Link\` 提供可用的 \`first/prev/next/last\`，游标模式只提供安全签名的 \`next\`。链接只使用当前 pathname 和受控查询参数构造相对 URL，不信任请求 Origin，保留当前筛选、排序、裁剪和展开条件。排序相同值会自动追加主键消歧，翻页期间新增更早记录不会导致已有记录重复。游标模式在 meta 返回 \`nextCursor/hasMore/limit/total\`。字段筛选支持 \`eq/ne/gt/gte/lt/lte/contains/starts/ends/in/isnull\`，多个参数按 AND 组合；\`_sort=-price,name\` 可按最多 5 个字段排序。列表和单条 GET 可用 \`_fields=id,status\` 裁剪响应；有父表外键的资源可用 \`_expand=userId\` 在 \`userId_expanded\` 返回一层父记录。裁剪最多 50 个字段、展开最多 5 个外键且不会递归；未知字段或非外键展开返回 400。ETag 始终基于完整底层记录，不因返回字段变化而改变。为避免恶意查询拖慢本地页面，每次最多 50 个参数，名称最多 120 字符、普通值最多 1,000 字符、游标最多 4,200 字符、\`in\` 最多 50 项，超过时返回 400。列表响应包含集合 ETag、\`X-Total-Count\` 及可选 \`X-Next-Cursor\`；轮询时发送 \`If-None-Match\`，查询页和展开父记录都未变化会返回无响应体的 304，并保留分页响应头。集合 ETag 同时绑定查询参数、完整底层页记录、展开父记录、总数和游标元数据；隐藏字段变化也不会漏报。业务响应还包含稳定请求编号 \`X-Mock-Request-Id\` 和实际等待毫秒数 \`X-Mock-Latency\`，注入失败额外包含 \`X-Mock-Injected-Failure: true\`；单页最多 1,000 条。单条 GET/POST/PUT/PATCH/DELETE 返回基于当前记录内容的强 \`ETag\`；GET 可发送 \`If-None-Match\` 获得 304，PUT/PATCH/DELETE 可发送 \`If-Match\`，过期时返回 412 与最新 ETag，避免旧页面覆盖新数据。PUT 是真正的完整替换：URL 中的主键保持不变，未提交的可选字段会删除，全部必填字段始终要提供；PATCH 只合并请求中出现的字段。批量修改/删除可在每项携带 \`ifMatch\`，跨表事务的 update/delete 动作也支持它，任一过期会回滚全部前序变更。单条 POST、批量 POST 和跨表事务可发送 1–80 位 \`Idempotency-Key\`：同键、同方法、同路径和同请求体会原样重放且只写入一次，响应带 \`X-Mock-Idempotent-Replay: true\`；同键异参返回 409。缓存限制为最近 100 项和 10 MiB，请求签名输入限制 1 MiB；故障注入发生在幂等处理之前，因此模拟网络失败不会缓存，客户端可以按真实习惯重试。POST 自动补充缺失主键，主键或 Schema 中标记为 unique 的字段重复时返回 409 与 \`field/rule=unique\`。严格 Schema 校验关闭时，未知字段被兼容性丢弃；开启后，未知字段、类型、必填、空值、枚举、范围、长度和 PUT/PATCH 主键修改均返回 422，并附带 \`field\` 与 \`rule\`。开启外键校验时，POST/PUT/PATCH 的悬空外键返回 422。批量新增接受 JSON 数组或 \`{ items: [] }\`；单批最多 1,000 条。任一条格式、Schema、唯一、主键、外键、ETag 或引用策略失败都会整批不落库，并在错误中返回从 0 开始的 \`index\`。级联批量删除会在 \`meta.cascaded\` 返回额外清理的后代数量。

## 文件

- \`db.json\`：可直接读取或交给 json-server 等兼容工具。
- \`package.json\` / \`tsconfig.json\` / \`vitest.config.ts\`：独立可运行的测试工程配置，依赖使用精确版本。
- \`handlers.test.ts\`：真实请求验证分页、CRUD、接口调用预期、ETag 乐观锁、幂等重试、批量回滚、跨表事务、脱敏追踪、场景快照、控制接口、复位与关系策略。
- \`config.ts\`：种子、延迟、失败率、失败状态码、响应格式与 Schema/关系校验开关。
- \`handlers.ts\`：内存 CRUD、原子批量增改删、分页、搜索、字段筛选、响应裁剪、关联展开、排序与网络场景实现。
- \`browser.ts\` / \`server.ts\`：浏览器和 Node 测试入口。
- \`openapi.json\`：接口契约，可导入 Apifox、Postman 或 Swagger UI。
- \`routes.json\`：机器可读路由与网络行为清单。
`
}

export function mockApiSmokeTests(project:ProjectSchema){
  const first=project.tables[0],firstPrimary=primary(first),firstMutable=first.fields.find(field=>field.name!==firstPrimary.name)??firstPrimary,relations=relationSpecs(project),relation=relations[0]
  const firstRequired=first.fields.find(field=>field.name!==firstPrimary.name&&(field.missing??0)===0&&(field.nullable??0)===0&&!field.condition)??firstMutable
  const firstUniqueFields=first.fields.filter(field=>field.unique&&field.name!==firstPrimary.name).map(field=>field.name)
  const relationParent=relation?project.tables.find(table=>table.name===relation.parent):undefined,relationChild=relation?project.tables.find(table=>table.name===relation.child):undefined
  const [nestedBefore,nestedAfter]=relation?.path.split(':id')??['','']
  return `import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mockApiOptions } from './config'
import { db } from './handlers'
import { resetMockData, server } from './server'

const origin = 'http://localhost'
const unwrap = (body: unknown) => body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body
const configuredRouteOverrides = structuredClone(mockApiOptions.routeOverrides)

beforeAll(() => { Object.assign(mockApiOptions, { latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, validateSchema: false, routeOverrides: [] }); server.listen({ onUnhandledRequest: 'error' }) })
afterEach(() => { Object.assign(mockApiOptions, { latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, validateSchema: false, routeOverrides: [] }); server.resetHandlers(); resetMockData() })
afterAll(() => server.close())

describe(${JSON.stringify(project.name+' Mock API')}, () => {
  it('列表支持分页并返回总数', async () => {
    const response = await fetch(origin + ${JSON.stringify(`/api/${first.name}?_page=1&_limit=2`)})
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('X-Total-Count'))).toBe(db[${JSON.stringify(first.name)}].length)
    expect(unwrap(await response.json())).toHaveLength(Math.min(2, db[${JSON.stringify(first.name)}].length))
  })

  it('列表 ETag 避免重复传输并感知完整底层记录变化', async () => {
    const url = origin + ${JSON.stringify(`/api/${first.name}?_page=1&_limit=2&_fields=${firstPrimary.name}`)}
    const initial = await fetch(url), etag = initial.headers.get('ETag')!
    expect(etag).toMatch(/^"mock-list-/)
    const cached = await fetch(url, { headers: { 'If-None-Match': etag } })
    expect(cached.status).toBe(304); expect(await cached.text()).toBe('')
    db[${JSON.stringify(first.name)}][0].__hiddenRevision = 2
    const changed = await fetch(url, { headers: { 'If-None-Match': etag } })
    expect(changed.status).toBe(200); expect(changed.headers.get('ETag')).not.toBe(etag)
  })

  it('列表返回可直接续读的标准 Link 分页头', async () => {
    const page = await fetch(origin + ${JSON.stringify(`/api/${first.name}?_page=1&_limit=1&_sort=${firstPrimary.name}`)}), pageLink = page.headers.get('Link')!
    expect(pageLink).toContain('rel="first"'); expect(pageLink).toContain('rel="last"')
    if (db[${JSON.stringify(first.name)}].length > 1) expect(pageLink).toContain('rel="next"')
    const cursor = await fetch(origin + ${JSON.stringify(`/api/${first.name}?_cursor=start&_limit=1&_sort=${firstPrimary.name}`)}), cursorLink = cursor.headers.get('Link')
    if (cursor.headers.get('X-Next-Cursor')) { expect(cursorLink).toContain('rel="next"'); expect(cursorLink).toContain('_cursor=') }
  })

  it('游标分页绑定查询条件并拒绝篡改', async () => {
    const base = origin + ${JSON.stringify(`/api/${first.name}?_cursor=start&_limit=1&_sort=${firstPrimary.name}`)}
    const firstPage = await fetch(base), cursor = firstPage.headers.get('X-Next-Cursor')
    expect(firstPage.status).toBe(200)
    if (!cursor) return
    const nextPage = await fetch(origin + ${JSON.stringify(`/api/${first.name}?_cursor=`)} + encodeURIComponent(cursor) + ${JSON.stringify(`&_limit=1&_sort=${firstPrimary.name}`)})
    expect(nextPage.status).toBe(200)
    const tampered = cursor.slice(0, -1) + (cursor.endsWith('0') ? '1' : '0')
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}?_cursor=`)} + tampered + ${JSON.stringify(`&_limit=1&_sort=${firstPrimary.name}`)})).status).toBe(400)
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}?_cursor=`)} + encodeURIComponent(cursor) + ${JSON.stringify(`&_limit=1&_sort=${firstPrimary.name}&q=different`)})).status).toBe(400)
  })${relation?`

  it('裁剪响应字段并展开一层父记录', async () => {
    const child = db[${JSON.stringify(relation.child)}][0]
    const parent = db[${JSON.stringify(relation.parent)}].find(row => String(row[${JSON.stringify(relation.parentField)}]) === String(child[${JSON.stringify(relation.foreignKey)}]))
    const query = ${JSON.stringify(`?_limit=1&_fields=${primary(relationChild!).name},${relation.foreignKey}&_expand=${relation.foreignKey}`)}
    const list = await fetch(origin + ${JSON.stringify(`/api/${relation.child}`)} + query)
    expect(list.status).toBe(200)
    const rows = unwrap(await list.json()) as Record<string, unknown>[]
    expect(Object.keys(rows[0]).sort()).toEqual(${JSON.stringify([primary(relationChild!).name,relation.foreignKey,`${relation.foreignKey}_expanded`].sort())})
    expect(rows[0][${JSON.stringify(`${relation.foreignKey}_expanded`)}]).toEqual(parent)
    expect((rows[0][${JSON.stringify(`${relation.foreignKey}_expanded`)}] as Record<string, unknown>)[${JSON.stringify(`${relation.foreignKey}_expanded`)}]).toBeUndefined()
    const detail = await fetch(origin + ${JSON.stringify(`/api/${relation.child}/`)} + child[${JSON.stringify(primary(relationChild!).name)}] + ${JSON.stringify(`?_fields=${primary(relationChild!).name}&_expand=${relation.foreignKey}`)})
    expect(detail.status).toBe(200)
    expect(Object.keys(unwrap(await detail.json()) as Record<string, unknown>).sort()).toEqual(${JSON.stringify([primary(relationChild!).name,`${relation.foreignKey}_expanded`].sort())})
    expect((await fetch(origin + ${JSON.stringify(`/api/${relation.child}?_fields=__missing__`)})).status).toBe(400)
    expect((await fetch(origin + ${JSON.stringify(`/api/${relation.child}?_expand=${primary(relationChild!).name}`)})).status).toBe(400)
  })`:''}

  it('组合高级筛选、多字段排序并拒绝过量查询', async () => {
    const table = ${JSON.stringify(first.name)}, rows = db[table]
    const field = ${JSON.stringify(firstMutable.name)}, values = rows.slice(0, 2).map(row => encodeURIComponent(String(row[field] ?? '')))
    const response = await fetch(origin + ${JSON.stringify(`/api/${first.name}?`)} + encodeURIComponent(field + '__in') + '=' + values.join(',') + '&_sort=-' + encodeURIComponent(${JSON.stringify(firstPrimary.name)}))
    expect(response.status).toBe(200)
    const matched = unwrap(await response.json()) as Record<string, unknown>[]
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.every(row => rows.slice(0, 2).some(source => String(source[field]) === String(row[field])))).toBe(true)
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}?`)} + Array.from({ length: 51 }, (_, index) => 'x' + index + '=1').join('&'))).status).toBe(400)
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}?`)} + encodeURIComponent(field + '__contains') + '=' + encodeURIComponent('x'.repeat(1001)))).status).toBe(400)
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

  it('Idempotency-Key 防止创建请求在重试时重复写入', async () => {
    const table = ${JSON.stringify(first.name)}, before = db[table].length
    const request = () => fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'create-once-001' }, body: '{}' })
    const first = await request(), replayed = await request()
    expect(first.status).toBe(201); expect(replayed.status).toBe(201)
    expect(first.headers.get('X-Mock-Idempotency-Stored')).toBe('true')
    expect(replayed.headers.get('X-Mock-Idempotent-Replay')).toBe('true')
    expect(await replayed.json()).toEqual(await first.json())
    expect(db[table]).toHaveLength(before + 1)
    const conflict = await fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'create-once-001' }, body: '{"different":true}' })
    expect(conflict.status).toBe(409); expect(db[table]).toHaveLength(before + 1)
    expect((await fetch(origin + '/api/__mock/idempotency', { method: 'DELETE' })).status).toBe(200)
  })

  it('ETag 阻止过期页面覆盖最新记录', async () => {
    const row = db[${JSON.stringify(first.name)}][0], id = row[${JSON.stringify(firstPrimary.name)}], url = origin + ${JSON.stringify(`/api/${first.name}/`)} + id
    const initial = await fetch(url), initialEtag = initial.headers.get('ETag')!
    expect(initialEtag).toMatch(/^"mock-[a-f0-9-]+"$/)
    expect((await fetch(url, { headers: { 'If-None-Match': initialEtag } })).status).toBe(304)
    const changed = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', 'If-Match': initialEtag }, body: JSON.stringify({ ${JSON.stringify(firstMutable.name)}: 'latest-value' }) })
    expect(changed.status).toBe(200)
    const currentEtag = changed.headers.get('ETag')!; expect(currentEtag).not.toBe(initialEtag)
    const stale = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', 'If-Match': initialEtag }, body: JSON.stringify({ ${JSON.stringify(firstMutable.name)}: 'stale-value' }) })
    expect(stale.status).toBe(412); expect(stale.headers.get('ETag')).toBe(currentEtag)
    expect(db[${JSON.stringify(first.name)}][0][${JSON.stringify(firstMutable.name)}]).toBe('latest-value')
  })

  it('PUT 完整替换记录并执行必填与 ETag 保护', async () => {
    const row = db[${JSON.stringify(first.name)}][0], id = row[${JSON.stringify(firstPrimary.name)}], url = origin + ${JSON.stringify(`/api/${first.name}/`)} + id
    row.__legacy = 'must-disappear'
    const current = await fetch(url), etag = current.headers.get('ETag')!, replacement = structuredClone(row)
    delete replacement[${JSON.stringify(firstPrimary.name)}]; delete replacement.__legacy
    const replaced = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'If-Match': etag }, body: JSON.stringify(replacement) })
    expect(replaced.status).toBe(200)
    const body = unwrap(await replaced.json()) as Record<string, unknown>
    expect(body[${JSON.stringify(firstPrimary.name)}]).toBe(id); expect(body.__legacy).toBeUndefined()
    const missingRequired = structuredClone(replacement); delete missingRequired[${JSON.stringify(firstRequired.name)}]
    expect((await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(missingRequired) })).status).toBe(422)
    expect((await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'If-Match': etag }, body: JSON.stringify(replacement) })).status).toBe(412)
  })

  it('声明并验收接口调用次数和响应状态', async () => {
    const created = await fetch(origin + '/api/__mock/expectations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'GET', path: ${JSON.stringify(`/api/${first.name}/:id`)}, minCalls: 1, maxCalls: 1, statuses: [200] }) })
    expect(created.status).toBe(201)
    expect((await fetch(origin + '/api/__mock/expectations/verify')).status).toBe(409)
    const row = db[${JSON.stringify(first.name)}][0], id = row[${JSON.stringify(firstPrimary.name)}]
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}/`)} + id)).status).toBe(200)
    const passed = await fetch(origin + '/api/__mock/expectations/verify')
    expect(passed.status).toBe(200)
    expect(unwrap(await passed.json())).toMatchObject({ ok: true, passed: 1, pending: 0, failed: 0 })
    expect((await fetch(origin + '/api/__mock/expectations/reset', { method: 'POST' })).status).toBe(200)
    expect((await fetch(origin + '/api/__mock/expectations/verify')).status).toBe(409)
  })

  it('严格模式按 Schema 拒绝非法字段并返回定位信息', async () => {
    mockApiOptions.validateSchema = true
    const original = db[${JSON.stringify(first.name)}][0], valid = { ...original }
    delete valid[${JSON.stringify(firstPrimary.name)}]
    for (const field of ${JSON.stringify(firstUniqueFields)}) valid[field] = typeof valid[field] === 'number' ? Number(valid[field]) + 1_000_000_000 : typeof valid[field] === 'boolean' ? !valid[field] : String(valid[field]) + '-strict'
    const created = await fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid) })
    expect(created.status).toBe(201)
    const invalid = await fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...valid, __unexpected: true }) })
    expect(invalid.status).toBe(422)
    expect((await invalid.json() as { error: { field: string; rule: string } }).error).toMatchObject({ field: '__unexpected', rule: 'unknown_field' })
    const id = (unwrap(await created.json()) as Record<string, unknown>)[${JSON.stringify(firstPrimary.name)}]
    const immutable = await fetch(origin + ${JSON.stringify(`/api/${first.name}/`)} + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ${JSON.stringify(firstPrimary.name)}: id }) })
    expect(immutable.status).toBe(422)
    expect((await immutable.json() as { error: { rule: string } }).error.rule).toBe('immutable')
  })

  it('所有写入口拒绝唯一字段冲突', async () => {
    const existing = db[${JSON.stringify(first.name)}][0]
    const uniqueField = ${JSON.stringify(first.fields.find(field=>field.unique&&field.name!==firstPrimary.name)?.name??'')}
    if (!uniqueField) return
    const duplicate = { ...existing }; delete duplicate[${JSON.stringify(firstPrimary.name)}]
    const created = await fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(duplicate) })
    expect(created.status).toBe(409)
    expect((await created.json() as { error: { field: string; rule: string } }).error).toMatchObject({ field: uniqueField, rule: 'unique' })
    const second = db[${JSON.stringify(first.name)}][1]
    const patched = await fetch(origin + ${JSON.stringify(`/api/${first.name}/`)} + second[${JSON.stringify(firstPrimary.name)}], { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [uniqueField]: existing[uniqueField] }) })
    expect(patched.status).toBe(409)
    expect((await patched.json() as { error: { field: string; rule: string } }).error).toMatchObject({ field: uniqueField, rule: 'unique' })
  })

  it('记录可筛选的脱敏请求轨迹并支持单独清空', async () => {
    const response = await fetch(origin + ${JSON.stringify(`/api/${first.name}?token=secret-value`)}, { headers: { authorization: 'Bearer private-token', cookie: 'session=private' } })
    const requestId = response.headers.get('X-Mock-Request-Id')
    expect(requestId).toMatch(new RegExp('^mock-' + mockApiOptions.seed + '-[0-9]{6}$'))
    await response.json()
    const logsResponse = await fetch(origin + '/api/__mock/requests?method=GET&status=200&_limit=1')
    expect(logsResponse.status).toBe(200)
    const logs = unwrap(await logsResponse.json()) as Array<{ id: string; path: string; status: number }>
    expect(logs[0]).toMatchObject({ id: requestId, path: ${JSON.stringify(`/api/${first.name}`)}, status: 200 })
    const serialized = JSON.stringify(logs)
    expect(serialized).not.toContain('secret-value')
    expect(serialized).not.toContain('private-token')
    expect(serialized).not.toContain('session=private')
    expect((await fetch(origin + '/api/__mock/requests', { method: 'DELETE' })).status).toBe(200)
    expect(unwrap(await (await fetch(origin + '/api/__mock/requests')).json())).toEqual([])
  })

  it('保存、覆盖、恢复和删除整库场景快照', async () => {
    const table = ${JSON.stringify(first.name)}, initialCount = db[table].length
    const saved = await fetch(origin + '/api/__mock/snapshots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'baseline_基线' }) })
    expect(saved.status).toBe(201)
    expect(unwrap(await saved.json())).toMatchObject({ name: 'baseline_基线', totalRows: expect.any(Number) })
    expect((await fetch(origin + ${JSON.stringify(`/api/${first.name}`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(201)
    expect(db[table]).toHaveLength(initialCount + 1)
    expect((await fetch(origin + '/api/__mock/snapshots/baseline_%E5%9F%BA%E7%BA%BF/restore', { method: 'POST' })).status).toBe(200)
    expect(db[table]).toHaveLength(initialCount)
    expect(unwrap(await (await fetch(origin + '/api/__mock/snapshots')).json())).toHaveLength(1)
    expect((await fetch(origin + '/api/__mock/snapshots/baseline_%E5%9F%BA%E7%BA%BF', { method: 'DELETE' })).status).toBe(200)
    expect(unwrap(await (await fetch(origin + '/api/__mock/snapshots')).json())).toEqual([])
  })

  it('用安全别名原子执行跨表事务并在失败时整库回滚', async () => {
    const parentTable = ${JSON.stringify(relation?.parent??first.name)}, childTable = ${JSON.stringify(relation?.child??first.name)}
    const beforeParent = db[parentTable].length, beforeChild = db[childTable].length
    const actions = ${relation?`[
      { op: 'create', resource: parentTable, body: {}, as: 'newParent' },
      { op: 'create', resource: childTable, body: { ${JSON.stringify(relation.foreignKey)}: '$newParent.${primary(relationParent!).name}' }, as: 'newChild' },
      { op: 'update', resource: parentTable, id: '$newParent.${primary(relationParent!).name}', changes: {} },
      { op: 'delete', resource: childTable, id: '$newChild.${primary(relationChild!).name}' },
      { op: 'delete', resource: parentTable, id: '$newParent.${primary(relationParent!).name}' },
    ]`:`[{ op: 'create', resource: parentTable, body: {}, as: 'created' }]`}
    const committed = await fetch(origin + '/api/__mock/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actions }) })
    expect(committed.status).toBe(200)
    expect(unwrap(await committed.json())).toHaveLength(actions.length)
    expect(db[parentTable]).toHaveLength(beforeParent + ${relation?0:1})
    expect(db[childTable]).toHaveLength(beforeChild + ${relation?0:1})
    const beforeRollbackParent = db[parentTable].length, beforeRollbackChild = db[childTable].length
    const rejected = await fetch(origin + '/api/__mock/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([
      { op: 'create', resource: parentTable, body: {}, as: 'mustRollback' },
      { op: 'update', resource: parentTable, id: '__missing__', changes: {} },
    ]) })
    expect(rejected.status).toBe(404)
    expect((await rejected.json() as { error: { index: number } }).error.index).toBe(1)
    expect(db[parentTable]).toHaveLength(beforeRollbackParent)
    expect(db[childTable]).toHaveLength(beforeRollbackChild)
  })

  it('批量写入原子回滚，并通过控制接口检查和复位', async () => {
    const table = ${JSON.stringify(first.name)}, initialCount = db[table].length
    const created = await fetch(origin + ${JSON.stringify(`/api/${first.name}/_batch`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{}, {}]) })
    expect(created.status).toBe(201)
    const createdRows = unwrap(await created.json()) as Record<string, unknown>[]
    expect(createdRows).toHaveLength(2)
    const createdIds = createdRows.map(row => row[${JSON.stringify(firstPrimary.name)}])
    const patched = await fetch(origin + ${JSON.stringify(`/api/${first.name}/_batch`)}, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createdIds.map((id, index) => ({ id, changes: { ${JSON.stringify(firstMutable.name)}: 'batch-' + index } }))) })
    expect(patched.status).toBe(200)
    expect((unwrap(await patched.json()) as Record<string, unknown>[]).map(row => row[${JSON.stringify(firstMutable.name)}])).toEqual(['batch-0', 'batch-1'])
    const rejectedPatch = await fetch(origin + ${JSON.stringify(`/api/${first.name}/_batch`)}, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: createdIds[0], changes: { ${JSON.stringify(firstMutable.name)}: 'must-rollback' } }, { id: '__missing__', changes: {} }]) })
    expect(rejectedPatch.status).toBe(404)
    expect(db[table].find(row => String(row[${JSON.stringify(firstPrimary.name)}]) === String(createdIds[0]))?.[${JSON.stringify(firstMutable.name)}]).toBe('batch-0')
    const removed = await fetch(origin + ${JSON.stringify(`/api/${first.name}/_batch`)}, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: createdIds }) })
    expect(removed.status).toBe(200)
    expect(db[table]).toHaveLength(initialCount)
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
    const path = rule.path.replace(':id', '__smoke__'), init = ['POST', 'PUT', 'PATCH'].includes(rule.method)
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
    {name:'mock-api/browser.ts',content:"import { setupWorker } from 'msw/browser'\nimport { clearMockSnapshots, deleteMockSnapshot, handlers, listMockSnapshots, requestLog, resetMockData, restoreMockSnapshot, saveMockSnapshot } from './handlers'\n\nexport { clearMockSnapshots, deleteMockSnapshot, listMockSnapshots, requestLog, resetMockData, restoreMockSnapshot, saveMockSnapshot }\nexport const worker = setupWorker(...handlers)\nexport const startMockApi = () => worker.start({ onUnhandledRequest: 'bypass' })\n"},
    {name:'mock-api/server.ts',content:"import { setupServer } from 'msw/node'\nimport { clearMockSnapshots, deleteMockSnapshot, handlers, listMockSnapshots, requestLog, resetMockData, restoreMockSnapshot, saveMockSnapshot } from './handlers'\n\nexport { clearMockSnapshots, deleteMockSnapshot, listMockSnapshots, requestLog, resetMockData, restoreMockSnapshot, saveMockSnapshot }\nexport const server = setupServer(...handlers)\n"},
    {name:'mock-api/openapi.json',content:JSON.stringify(toOpenAPI(project,normalized),null,2)},
    {name:'mock-api/routes.json',content:JSON.stringify({behavior:normalized,controlRoutes:mockApiControlRoutes,routes:mockApiRoutes(project,normalized)},null,2)},
    {name:'mock-api/README.md',content:mockApiReadme(project,normalized)},
  ]
}

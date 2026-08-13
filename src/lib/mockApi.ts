import type { DataRow, GeneratedData, ProjectSchema, TableSchema } from '../types'
import { toOpenAPI } from './schemaExport'

interface MockApiFile { name:string;content:string }
const clean=(row:DataRow)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_mock_meta'))
const primary=(table:TableSchema)=>table.fields.find(field=>field.primaryKey)??table.fields.find(field=>field.unique)??table.fields.find(field=>field.name==='id')??table.fields[0]
const literal=(value:unknown)=>JSON.stringify(value,null,2).replaceAll('</','<\\/')

export function mockApiRoutes(project:ProjectSchema){return project.tables.map(table=>({resource:table.name,label:table.label,primaryKey:primary(table).name,list:`/api/${table.name}`,detail:`/api/${table.name}/:id`,methods:['GET','POST','PATCH','DELETE']}))}

export function mockApiHandlers(project:ProjectSchema,data:GeneratedData){
  const initial=Object.fromEntries(project.tables.map(table=>[table.name,(data[table.id]??[]).map(clean)]))
  const definitions=project.tables.map(table=>{const key=primary(table);return`  { resource: ${JSON.stringify(table.name)}, key: ${JSON.stringify(key.name)}, numericKey: ${key.dataType==='number'}, fields: ${JSON.stringify(table.fields.map(field=>field.name))} },`}).join('\n')
  return `import { http, HttpResponse } from 'msw'\n\ntype MockRecord = Record<string, unknown>\ntype MockDatabase = Record<string, MockRecord[]>\ntype ResourceDefinition = { resource: string; key: string; numericKey: boolean; fields: readonly string[] }\n\nconst initialDb: MockDatabase = ${literal(initial)}\nexport const db: MockDatabase = structuredClone(initialDb)\n\nconst resources: readonly ResourceDefinition[] = [\n${definitions}\n]\nconst controlParams = new Set(['q', '_page', '_limit', '_sort', '_order'])\nconst sameId = (left: unknown, right: unknown) => String(left) === String(right)\nconst jsonBody = async (request: Request) => {\n  try { const value = await request.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as MockRecord : null } catch { return null }\n}\nconst allowedBody = (body: MockRecord, resource: ResourceDefinition) => Object.fromEntries(Object.entries(body).filter(([field]) => resource.fields.includes(field)))\n\nexport const resetMockData = () => {\n  for (const resource of resources) db[resource.resource] = structuredClone(initialDb[resource.resource])\n}\n\nexport const handlers = resources.flatMap(resource => [\n  http.get(\`/api/\${resource.resource}\`, ({ request }) => {\n    const url = new URL(request.url), query = (url.searchParams.get('q') ?? '').toLocaleLowerCase()\n    let rows = [...db[resource.resource]]\n    if (query) rows = rows.filter(row => Object.values(row).some(value => String(value ?? '').toLocaleLowerCase().includes(query)))\n    url.searchParams.forEach((value, field) => {\n      if (!controlParams.has(field) && resource.fields.includes(field)) rows = rows.filter(row => String(row[field] ?? '') === value)\n    })\n    const sort = url.searchParams.get('_sort'), order = url.searchParams.get('_order') === 'desc' ? -1 : 1\n    if (sort && resource.fields.includes(sort)) rows.sort((left, right) => String(left[sort] ?? '').localeCompare(String(right[sort] ?? ''), undefined, { numeric: true }) * order)\n    const page = Math.max(1, Number(url.searchParams.get('_page')) || 1), limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('_limit')) || 20))\n    return HttpResponse.json(rows.slice((page - 1) * limit, page * limit), { headers: { 'X-Total-Count': String(rows.length) } })\n  }),\n  http.get(\`/api/\${resource.resource}/:id\`, ({ params }) => {\n    const row = db[resource.resource].find(item => sameId(item[resource.key], params.id))\n    return row ? HttpResponse.json(row) : HttpResponse.json({ message: 'Not found' }, { status: 404 })\n  }),\n  http.post(\`/api/\${resource.resource}\`, async ({ request }) => {\n    const input = await jsonBody(request); if (!input) return HttpResponse.json({ message: 'JSON object required' }, { status: 400 })\n    const body = allowedBody(input, resource)\n    if (body[resource.key] == null) body[resource.key] = resource.numericKey ? Math.max(0, ...db[resource.resource].map(item => Number(item[resource.key]) || 0)) + 1 : crypto.randomUUID()\n    if (db[resource.resource].some(item => sameId(item[resource.key], body[resource.key]))) return HttpResponse.json({ message: 'Primary key already exists' }, { status: 409 })\n    db[resource.resource].push(body); return HttpResponse.json(body, { status: 201 })\n  }),\n  http.patch(\`/api/\${resource.resource}/:id\`, async ({ params, request }) => {\n    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id)), input = await jsonBody(request)\n    if (index < 0) return HttpResponse.json({ message: 'Not found' }, { status: 404 })\n    if (!input) return HttpResponse.json({ message: 'JSON object required' }, { status: 400 })\n    const body = allowedBody(input, resource)\n    db[resource.resource][index] = { ...db[resource.resource][index], ...body, [resource.key]: db[resource.resource][index][resource.key] }\n    return HttpResponse.json(db[resource.resource][index])\n  }),\n  http.delete(\`/api/\${resource.resource}/:id\`, ({ params }) => {\n    const index = db[resource.resource].findIndex(item => sameId(item[resource.key], params.id))\n    if (index < 0) return HttpResponse.json({ message: 'Not found' }, { status: 404 })\n    const [deleted] = db[resource.resource].splice(index, 1); return HttpResponse.json(deleted)\n  }),\n])\n`
}

export function mockApiReadme(project:ProjectSchema){const routes=mockApiRoutes(project);return`# ${project.name} Mock API

此包由 Mock造数工具生成。数据已固定为 seed ${project.seed}、时间基准 ${project.referenceDate??'2026-08-14T00:00:00.000Z'}，不需要连接服务器或数据库。它只在使用者自己的浏览器或测试进程内运行，不会在 Mock造数工具公共站点创建可写接口。

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
import { server } from './mock-api/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
\`\`\`

## 路由

${routes.map(route=>`- \`GET ${route.list}?_page=1&_limit=20&_sort=${route.primaryKey}&_order=asc&q=关键字\`
- \`GET ${route.list}?字段名=精确值\`
- \`GET ${route.detail}\`
- \`POST ${route.list}\`
- \`PATCH ${route.detail}\`
- \`DELETE ${route.detail}\``).join('\n')}

列表响应包含 \`X-Total-Count\`；单页最多 1,000 条。POST 自动补充缺失主键并拒绝重复主键，PATCH 不允许修改主键，请求中不属于当前 Schema 的字段会被丢弃。调用 \`resetMockData()\` 可恢复初始数据。

## 文件

- \`db.json\`：可直接读取或交给 json-server 等兼容工具。
- \`handlers.ts\`：内存 CRUD、分页、搜索、字段筛选和排序实现。
- \`browser.ts\` / \`server.ts\`：浏览器和 Node 测试入口。
- \`openapi.json\`：接口契约，可导入 Apifox、Postman 或 Swagger UI。
- \`routes.json\`：机器可读路由清单。
`}

export function mockApiFiles(project:ProjectSchema,data:GeneratedData):MockApiFile[]{
  const database=Object.fromEntries(project.tables.map(table=>[table.name,(data[table.id]??[]).map(clean)]))
  return[
    {name:'mock-api/db.json',content:JSON.stringify(database,null,2)},
    {name:'mock-api/handlers.ts',content:mockApiHandlers(project,data)},
    {name:'mock-api/browser.ts',content:"import { setupWorker } from 'msw/browser'\nimport { handlers } from './handlers'\n\nexport const worker = setupWorker(...handlers)\nexport const startMockApi = () => worker.start({ onUnhandledRequest: 'bypass' })\n"},
    {name:'mock-api/server.ts',content:"import { setupServer } from 'msw/node'\nimport { handlers } from './handlers'\n\nexport const server = setupServer(...handlers)\n"},
    {name:'mock-api/openapi.json',content:JSON.stringify(toOpenAPI(project),null,2)},
    {name:'mock-api/routes.json',content:JSON.stringify(mockApiRoutes(project),null,2)},
    {name:'mock-api/README.md',content:mockApiReadme(project)},
  ]
}

import type { FieldRule, ProjectSchema, TableSchema } from '../types'
import { ENUM_VALUES } from '../data/enumValues'
import { createZip, GENERATOR_VERSION, sha256Fallback } from './exporters'
import { sortTables } from './modeling'
import { normalizeMockApiOptions, type MockApiOptions } from './mockApiOptions'

type Dialect='mysql'|'postgres'|'sqlite'
type ContractFile={name:string;content:string}
const encoder=new TextEncoder()
const safeName=(value:string)=>value.replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g,'_').slice(0,80)||'mock-schema'
const quote=(value:string,dialect:Dialect)=>dialect==='mysql'?`\`${value.replaceAll('`','``')}\``:`"${value.replaceAll('"','""')}"`
const enumValues=(field:FieldRule)=>field.values?.length?field.values:ENUM_VALUES[field.generator]
const normalizedEnum=(field:FieldRule)=>enumValues(field)?.map(value=>field.dataType==='number'&&Number.isFinite(Number(value))?Number(value):field.dataType==='boolean'&&['true','false'].includes(String(value))?String(value)==='true':value)
const required=(field:FieldRule)=>(field.missing??0)===0&&(field.nullable??0)===0&&!field.condition
const formatFor=(field:FieldRule)=>({email:'email',uuid:'uuid',url:'uri',date:'date',pastDate:'date',futureDate:'date',dateTime:'date-time',ipv4:'ipv4',ipv6:'ipv6'} as Record<string,string>)[field.generator]

export function fieldJsonSchema(field:FieldRule){
  const schema:Record<string,unknown>={title:field.label,type:field.dataType==='date'?'string':field.dataType}
  const format=formatFor(field);if(format)schema.format=format
  const values=normalizedEnum(field);if(values?.length)schema.enum=values
  if(field.min!==undefined)schema.minimum=field.min;if(field.max!==undefined)schema.maximum=field.max;if(field.length!==undefined)schema.maxLength=field.length
  if(field.nullable)schema.type=[schema.type,'null']
  if(field.ref)schema['x-foreign-key']={tableId:field.ref.tableId,field:field.ref.field,strategy:field.ref.strategy??'random',...(field.ref.strategy==='hotspot'?{hotspotPercent:field.ref.hotspotPercent??20}:{})}
  if(field.generator)schema['x-mock-generator']=field.generator
  if(field.formula)schema['x-mock-formula']=field.formula
  if(field.condition)schema['x-mock-condition']=field.condition
  if(field.relationValue)schema['x-mock-relation-value']=field.relationValue
  return schema
}

const tableJsonSchema=(table:TableSchema)=>{const requiredFields=table.fields.filter(required).map(field=>field.name);return{title:table.label,type:'object',additionalProperties:false,properties:Object.fromEntries(table.fields.map(field=>[field.name,fieldJsonSchema(field)])),...(requiredFields.length?{required:requiredFields}:{}),...(table.countByReference?{'x-mock-cardinality':table.countByReference}:{}),...(table.assertions?.length?{'x-mock-assertions':table.assertions}:{})}}

export function toJSONSchema(project:ProjectSchema){return{$schema:'https://json-schema.org/draft/2020-12/schema',$id:`urn:mock-data:${project.id}`,title:project.name,description:project.description,type:'object',properties:Object.fromEntries(project.tables.map(table=>[table.name,{type:'array',items:{$ref:`#/$defs/${table.name}`}}])),$defs:Object.fromEntries(project.tables.map(table=>[table.name,tableJsonSchema(table)])),'x-mock-seed':project.seed,'x-mock-reference-date':project.referenceDate,'x-mock-mode':project.mode,'x-schema-version':project.version}}

export function toOpenAPI(project:ProjectSchema,options?:Partial<MockApiOptions>){
  const behavior=normalizeMockApiOptions(options),latencyHeader={'X-Mock-Latency':{description:'Mock 实际等待毫秒数',schema:{type:'integer'}}},errorSchema={type:'object',properties:{error:{type:'object',properties:{status:{type:'integer'},message:{type:'string'},index:{type:'integer',minimum:0}},required:['status','message']}},required:['error']}
  const wrapped=(schema:Record<string,unknown>,list=false):Record<string,unknown>=>behavior.envelope==='plain'?schema:behavior.envelope==='data'?{type:'object',properties:{data:schema},required:['data']}:{type:'object',properties:{data:schema,meta:list?{type:'object',properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'}},required:['page','limit','total']}:{type:'object'}},required:['data','meta']}
  const success=(schema:Record<string,unknown>,description:string,status='200',list=false)=>({[status]:{description,headers:{...latencyHeader,...(list?{'X-Total-Count':{schema:{type:'integer'}}}:{})},content:{'application/json':{schema:wrapped(schema,list)}}}})
  const failure=(status:number|string,description:string)=>({[String(status)]:{description,headers:latencyHeader,content:{'application/json':{schema:errorSchema}}}})
  const paths=Object.fromEntries(project.tables.flatMap(table=>{
    const primary=table.fields.find(field=>field.primaryKey)??table.fields.find(field=>field.unique)??table.fields[0],schemaRef={$ref:`#/components/schemas/${table.name}`},listSchema={type:'array',items:schemaRef},listPath=`/api/${table.name}`,detailPath=`${listPath}/{id}`,batchPath=`${listPath}/_batch`,tag=table.label,pathParameters=[{name:'id',in:'path',required:true,schema:{type:primary.dataType==='number'?'number':'string'}}],bodySchema={type:'object',additionalProperties:false,properties:tableJsonSchema(table).properties},injected=behavior.failureRate>0?failure(behavior.failureStatus,`按 ${behavior.failureRate}% 确定性注入的网络失败`):{},hasForeignKeys=table.fields.some(field=>field.ref),isReferenced=project.tables.some(candidate=>candidate.fields.some(field=>field.ref?.tableId===table.id))
    const list={get:{tags:[tag],summary:`查询${table.label}列表`,parameters:[['_page','integer'],['_limit','integer'],['_sort','string'],['_order','string'],['q','string'],...table.fields.map(field=>[field.name,field.dataType==='number'?'number':'string'])].map(([name,type])=>({name,in:'query',required:false,schema:{type}})),responses:{...success(listSchema,'分页列表','200',true),...injected}},post:{tags:[tag],summary:`新增${table.label}`,requestBody:{required:true,content:{'application/json':{schema:bodySchema}}},responses:{...success(schemaRef,'创建成功','201'),...failure(400,'请求体不是 JSON 对象'),...failure(409,'主键已存在'),...(behavior.validateForeignKeys&&hasForeignKeys?failure(422,'外键指向的父记录不存在'):{}),...injected}}}
    const detail={get:{tags:[tag],summary:`查询单条${table.label}`,parameters:pathParameters,responses:{...success(schemaRef,'查询成功'),...failure(404,'记录不存在'),...injected}},patch:{tags:[tag],summary:`修改${table.label}`,parameters:pathParameters,requestBody:{required:true,content:{'application/json':{schema:bodySchema}}},responses:{...success(schemaRef,'修改成功'),...failure(400,'请求体不是 JSON 对象'),...failure(404,'记录不存在'),...(behavior.validateForeignKeys&&hasForeignKeys?failure(422,'外键指向的父记录不存在'):{}),...injected}},delete:{tags:[tag],summary:`删除${table.label}`,description:behavior.deletePolicy==='cascade'?'递归级联删除所有后代记录':'存在引用当前记录的子记录时拒绝删除',parameters:pathParameters,responses:{...success(schemaRef,'删除成功'),...failure(404,'记录不存在'),...(behavior.deletePolicy==='restrict'&&isReferenced?failure(409,'记录仍被子表引用'):{}),...injected}}}
    const batch={post:{tags:[tag],summary:`原子批量新增${table.label}`,description:'一次创建 1–1,000 条；任一记录失败则整批回滚，错误响应 index 为失败项的从零下标。',requestBody:{required:true,content:{'application/json':{schema:{oneOf:[{type:'array',minItems:1,maxItems:1000,items:bodySchema},{type:'object',required:['items'],properties:{items:{type:'array',minItems:1,maxItems:1000,items:bodySchema}}}]}}}},responses:{...success(listSchema,'整批创建成功','201'),...failure(400,'批量请求格式错误或超过上限'),...failure(409,'某条记录主键已存在'),...(behavior.validateForeignKeys&&hasForeignKeys?failure(422,'某条记录的外键指向不存在'):{}),...injected}}}
    return[[listPath,list],[detailPath,detail],[batchPath,batch]]
  }))
  if(behavior.nestedRoutes)for(const child of project.tables)for(const field of child.fields.filter(candidate=>candidate.ref)){const parent=project.tables.find(table=>table.id===field.ref!.tableId);if(!parent)continue;const duplicate=child.fields.filter(candidate=>candidate.ref?.tableId===parent.id).length>1,path=`/api/${parent.name}/{id}/${child.name}${duplicate?`/by-${field.name}`:''}`,childSchema={type:'array',items:{$ref:`#/components/schemas/${child.name}`}},parentPrimary=parent.fields.find(candidate=>candidate.primaryKey)??parent.fields[0];paths[path]={get:{tags:[parent.label,child.label],summary:`查询${parent.label}关联的${child.label}`,description:`通过 ${child.name}.${field.name} 关联`,parameters:[{name:'id',in:'path',required:true,schema:{type:parentPrimary.dataType==='number'?'number':'string'}}],responses:{...success(childSchema,'关联数据','200',true),...failure(404,'父记录不存在'),...(behavior.failureRate>0?failure(behavior.failureStatus,`按 ${behavior.failureRate}% 确定性注入的网络失败`):{})}}}}
  const summarySchema={type:'object',properties:{status:{type:'string',enum:['ok']},seed:{type:'integer'},tables:{type:'integer'},rows:{type:'object',additionalProperties:{type:'integer'}}},required:['status','seed','tables','rows']},controlResponse={description:'Mock 数据状态',content:{'application/json':{schema:wrapped(summarySchema)}}}
  paths['/api/__mock/health']={get:{tags:['Mock 控制'],summary:'检查本地 Mock 数据状态',description:'不经过延迟与失败注入。',responses:{'200':controlResponse}}}
  paths['/api/__mock/reset']={post:{tags:['Mock 控制'],summary:'恢复全部初始数据',description:'恢复数据并清空确定性网络场景请求序列；不经过延迟与失败注入。',responses:{'200':controlResponse}}}
  return{openapi:'3.1.0',info:{title:`${project.name} Mock API`,description:project.description,version:project.version},servers:[{url:'http://localhost',description:'MSW 本地拦截'}],paths,components:{schemas:Object.fromEntries(project.tables.map(table=>[table.name,tableJsonSchema(table)]))},'x-mock-project':{templateId:project.templateId,seed:project.seed,referenceDate:project.referenceDate,mode:project.mode},'x-mock-api-behavior':behavior}
}

const integerLike=new Set(['autoId','sequence','integer','positiveInt','negativeInt','age','playerLevel','experience','gold','fileSize','timestamp','percentage'])
const sqlType=(field:FieldRule,dialect:Dialect)=>{if(dialect==='sqlite')return field.dataType==='number'?(integerLike.has(field.generator)?'INTEGER':'REAL'):field.dataType==='boolean'?'INTEGER':'TEXT';if(field.dataType==='number'){if(integerLike.has(field.generator))return'BIGINT';return dialect==='mysql'?`DECIMAL(20, ${field.precision??2})`:`NUMERIC(20, ${field.precision??2})`}if(field.dataType==='boolean')return dialect==='mysql'?'TINYINT(1)':'BOOLEAN';if(field.dataType==='date')return dialect==='mysql'?'DATETIME':'TIMESTAMPTZ';if(field.dataType==='object')return dialect==='mysql'?'JSON':'JSONB';if(field.length&&field.length<=4000)return`VARCHAR(${Math.max(1,field.length)})`;return'TEXT'}

export function toDDL(project:ProjectSchema,dialect:Dialect){
  const lines=[`-- ${project.name} · Schema ${project.version} · generated by Mock造数工具`,`-- Dialect: ${dialect}`]
  for(const table of sortTables(project.tables)){const columns=table.fields.map(field=>{const constraints=[required(field)?'NOT NULL':'',field.primaryKey?'PRIMARY KEY':'',field.unique&&!field.primaryKey?'UNIQUE':''].filter(Boolean).join(' ');return`  ${quote(field.name,dialect)} ${sqlType(field,dialect)}${constraints?` ${constraints}`:''}`}),foreignKeys=table.fields.filter(field=>field.ref).map(field=>{const target=project.tables.find(candidate=>candidate.id===field.ref!.tableId);return target?`  FOREIGN KEY (${quote(field.name,dialect)}) REFERENCES ${quote(target.name,dialect)} (${quote(field.ref!.field,dialect)})`:''}).filter(Boolean);lines.push(`CREATE TABLE IF NOT EXISTS ${quote(table.name,dialect)} (\n${[...columns,...foreignKeys].join(',\n')}\n);`)}return`${lines.join('\n\n')}\n`
}

const typeName=(value:string)=>value.split(/[^A-Za-z0-9]+/).filter(Boolean).map(part=>part[0].toUpperCase()+part.slice(1)).join('')||'MockRecord'
const tsType=(field:FieldRule)=>{const values=normalizedEnum(field);let base=values?.length&&values.length<=50?values.map(value=>JSON.stringify(value)).join(' | '):field.dataType==='number'?'number':field.dataType==='boolean'?'boolean':field.dataType==='object'?'Record<string, unknown>':'string';if(field.nullable||field.condition?.otherwise==='null')base+=` | null`;return base}
export function toTypeScript(project:ProjectSchema){return`${project.tables.map(table=>`/** ${table.label} · 默认 ${table.count} 条 */\nexport interface ${typeName(table.name)} {\n${table.fields.map(field=>`  /** ${field.label}${field.ref?` · FK → ${field.ref.tableId}.${field.ref.field}`:''} */\n  ${field.name}${(field.missing??0)>0||field.condition?.otherwise==='omit'?'?':''}: ${tsType(field)};`).join('\n')}\n}`).join('\n\n')}\n`}

export function relationMarkdown(project: ProjectSchema) {
  const labels = { random:'种子随机', roundRobin:'轮询均匀', hotspot:'热点 80/20', oneToOne:'严格一对一' }
  const relations = project.tables.flatMap(table => table.fields.filter(field => field.ref).map(field => {
    const target = project.tables.find(candidate => candidate.id === field.ref!.tableId)
    const strategy = field.ref!.strategy ?? 'random'
    const cardinality = table.countByReference?.fieldId === field.id ? table.countByReference : null
    const description = cardinality ? `每个父记录 ${cardinality.min}–${cardinality.max} 条` : `${labels[strategy]}${strategy === 'hotspot' ? `，热点池 ${field.ref!.hotspotPercent ?? 20}%` : ''}`
    return `- \`${table.name}.${field.name}\` → \`${target?.name ?? field.ref!.tableId}.${field.ref!.field}\`（${description}）`
  }))
  const calculations = project.tables.flatMap(table => table.fields.filter(field => field.relationValue).map(field => {
    const rule = field.relationValue!
    if (rule.kind === 'aggregate') return `- \`${table.name}.${field.name}\` = ${rule.operation.toUpperCase()}(\`${rule.sourceTableId}.${rule.expression}\`)（通过 \`${rule.sourceForeignKey}\` 分组，小数精度 ${rule.precision ?? 2}）`
    return `- \`${table.name}.${field.name}\` ← \`${rule.sourceTableId}.${rule.sourceField}\`（\`${field.name}\` 所在行的 \`${rule.localForeignKey}\` = \`${rule.sourceKey}\`）`
  }))
  const assertions = project.tables.flatMap(table => (table.assertions ?? []).map(assertion => `- **${table.label}.${assertion.name}**：\`${assertion.expression}\`（${assertion.severity === 'error' ? '失败' : '警告'}；${assertion.message}）`))
  const tables = sortTables(project.tables).map((table,index) => `${index + 1}. **${table.label}**（\`${table.name}\`）：${table.fields.length} 字段，${table.countByReference ? `按父记录生成 ${table.countByReference.min}–${table.countByReference.max} 条子数据` : `默认 ${table.count} 条`}`).join('\n')
  return `# ${project.name} Schema 关系说明\n\n- Schema 版本：${project.version}\n- 随机种子：${project.seed}\n- 时间基准：${project.referenceDate ?? '兼容旧项目默认值'}\n- 造数模式：${project.mode}\n- 数据表：${project.tables.length}\n- 字段：${project.tables.reduce((sum,table)=>sum+table.fields.length,0)}\n\n## 数据表\n\n${tables}\n\n## 外键关系\n\n${relations.length ? relations.join('\n') : '- 当前项目没有外键关系。'}\n\n## 跨表计算\n\n${calculations.length ? calculations.join('\n') : '- 当前项目没有跨表计算规则。'}\n\n## 业务断言\n\n${assertions.length ? assertions.join('\n') : '- 当前项目没有业务断言。'}\n`
}

export function schemaContractFiles(project:ProjectSchema):ContractFile[]{return[
  {name:'json-schema.json',content:JSON.stringify(toJSONSchema(project),null,2)},
  {name:'openapi.json',content:JSON.stringify(toOpenAPI(project),null,2)},
  {name:'types.ts',content:toTypeScript(project)},
  {name:'ddl/mysql.sql',content:toDDL(project,'mysql')},
  {name:'ddl/postgres.sql',content:toDDL(project,'postgres')},
  {name:'ddl/sqlite.sql',content:toDDL(project,'sqlite')},
  {name:'RELATIONS.md',content:relationMarkdown(project)},
]}

const digest=async(value:string)=>{const bytes=encoder.encode(value);if(globalThis.crypto?.subtle)return[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');return sha256Fallback(bytes)}
export async function createSchemaContractPackage(project:ProjectSchema){const createdAt=new Date(),files=schemaContractFiles(project),manifest={manifestVersion:1,kind:'schema-contract',projectName:project.name,schemaVersion:project.version,generatorVersion:GENERATOR_VERSION,randomSeed:project.seed,referenceDate:project.referenceDate,packagedAt:createdAt.toISOString(),files:await Promise.all(files.map(async file=>({name:file.name,bytes:encoder.encode(file.content).length,sha256:await digest(file.content)})))},zip=createZip([...files,{name:'manifest.json',content:JSON.stringify(manifest,null,2)}],createdAt);return{blob:new Blob([zip],{type:'application/zip'}),filename:`${safeName(project.name)}_schema.zip`,manifest}}
export async function exportSchemaContract(project:ProjectSchema){const result=await createSchemaContractPackage(project),url=URL.createObjectURL(result.blob),anchor=document.createElement('a');anchor.href=url;anchor.download=result.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return result}

import type { DataType, FieldRule, ProjectSchema, TableSchema } from '../types'
import { MAX_CONFIG_BYTES } from './projectConfig'

export interface ImportPreview { source:'openapi'|'json'; project:ProjectSchema; warnings:string[] }

const MAX_TABLES=50,MAX_FIELDS=200
const safeName=(value:string,fallback:string)=>{const normalized=value.trim().replace(/[^A-Za-z0-9_]/g,'_').replace(/^([^A-Za-z_])/,'_$1').slice(0,80);return normalized||fallback}
const label=(value:string)=>value.replace(/[_-]+/g,' ').trim().slice(0,80)||'未命名'
const id=()=>`f_${Date.now()}_${Math.random().toString(36).slice(2,8)}`
const lower=(value:string)=>value.toLowerCase()

function inferGenerator(name:string,type:DataType,format?:string){
  const key=lower(name),formats:Record<string,string>={uuid:'uuid',email:'email',uri:'url',url:'url',date:'date','date-time':'dateTime',ipv4:'ipv4',ipv6:'ipv6',hostname:'domain'}
  if(format&&formats[format])return formats[format]
  if(/(^|_)(id)$/.test(key)||key==='id')return type==='string'?'uuid':'autoId'
  if(/phone|mobile/.test(key))return'phone';if(/email/.test(key))return'email';if(/name/.test(key))return'chineseName';if(/address/.test(key))return'address';if(/city/.test(key))return'city';if(/province/.test(key))return'province'
  if(/amount|price|fee|balance|total/.test(key))return'amount';if(/status|state/.test(key))return'customEnum';if(/url|link/.test(key))return'url';if(/ip/.test(key))return'ipv4';if(/time|date|created|updated|expired/.test(key))return type==='number'?'timestamp':'dateTime'
  return type==='number'?'integer':type==='boolean'?'boolean':type==='date'?'dateTime':'randomString'
}

function schemaType(schema:Record<string,unknown>):DataType {const type=Array.isArray(schema.type)?schema.type.find(value=>value!=='null'):schema.type;if(type==='integer'||type==='number')return'number';if(type==='boolean')return'boolean';if(type==='object'||type==='array')return'object';if(schema.format==='date'||schema.format==='date-time')return'date';return'string'}

function schemaField(name:string,schema:Record<string,unknown>,required:boolean):FieldRule {
  const dataType=schemaType(schema),format=typeof schema.format==='string'?schema.format:undefined,values=Array.isArray(schema.enum)?schema.enum.slice(0,10_000).map(String):undefined,generator=values?.length?'customEnum':inferGenerator(name,dataType,format)
  const field:FieldRule={id:id(),name:safeName(name,'field'),label:typeof schema.title==='string'?schema.title.slice(0,80):label(name),generator,dataType,missing:required?0:15}
  if(values?.length)field.values=values;if(typeof schema.minimum==='number')field.min=schema.minimum;if(typeof schema.maximum==='number')field.max=schema.maximum;if(typeof schema.maxLength==='number')field.length=Math.min(10_000,Math.max(0,schema.maxLength));if(schema.nullable===true)field.nullable=10
  if(field.name==='id'||field.name.endsWith('_id')&&schema['x-primary-key']===true){field.primaryKey=true;field.unique=true}
  return field
}

function objectTable(name:string,schema:Record<string,unknown>,index:number):TableSchema {
  const properties=schema.properties&&typeof schema.properties==='object'&&!Array.isArray(schema.properties)?schema.properties as Record<string,unknown>:{}
  const required=new Set(Array.isArray(schema.required)?schema.required.map(String):[]),entries=Object.entries(properties).slice(0,MAX_FIELDS)
  const fields=entries.map(([fieldName,value])=>schemaField(fieldName,value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{},required.has(fieldName)))
  if(!fields.length)fields.push({id:id(),name:'id',label:'ID',generator:'autoId',dataType:'number',primaryKey:true,unique:true})
  const primary=fields.find(field=>field.name==='id')||fields.find(field=>field.name.endsWith('Id')||field.name.endsWith('_id'));if(primary){primary.primaryKey=true;primary.unique=true}
  return{id:`imported_${index}_${safeName(name,'table').toLowerCase()}`,name:safeName(name,`table_${index+1}`).toLowerCase(),label:typeof schema.title==='string'?schema.title.slice(0,80):label(name),count:20,fields}
}

function connectIdReferences(tables:TableSchema[]){const aliases=new Map<string,TableSchema>();tables.forEach(table=>{for(const value of [table.name,table.name.replace(/s$/,''),table.id.split('_').slice(2).join('_')])aliases.set(lower(value),table)});tables.forEach(table=>table.fields.forEach(field=>{if(field.primaryKey)return;const match=field.name.match(/^(.+?)(?:_?id)$/i);if(!match)return;const target=aliases.get(lower(match[1]))||aliases.get(`${lower(match[1])}s`);const primary=target?.fields.find(candidate=>candidate.primaryKey);if(target&&primary&&target.id!==table.id){field.ref={tableId:target.id,field:primary.name};field.dataType=primary.dataType;field.generator=primary.generator}}))}

function fromOpenApi(document:Record<string,unknown>):ImportPreview {
  const components=document.components&&typeof document.components==='object'?document.components as Record<string,unknown>:undefined,schemas=components?.schemas&&typeof components.schemas==='object'&&!Array.isArray(components.schemas)?components.schemas as Record<string,unknown>:{}
  const entries=Object.entries(schemas).slice(0,MAX_TABLES),warnings:string[]=[];if(Object.keys(schemas).length>MAX_TABLES)warnings.push(`仅导入前 ${MAX_TABLES} 个 components.schemas`)
  const tables=entries.filter(([,schema])=>schema&&typeof schema==='object'&&!Array.isArray(schema)).map(([name,schema],index)=>objectTable(name,schema as Record<string,unknown>,index));if(!tables.length)throw new Error('OpenAPI 文档中没有可导入的 components.schemas 对象')
  connectIdReferences(tables);const info=document.info&&typeof document.info==='object'?document.info as Record<string,unknown>:{};return{source:'openapi',warnings,project:{id:`project_${Date.now()}`,name:typeof info.title==='string'?`${info.title.slice(0,80)} Mock 数据`:'OpenAPI Mock 数据',templateId:'imported-openapi',description:'从 OpenAPI 3.x JSON Schema 本地推断生成',seed:20250814,mode:'random',version:typeof info.version==='string'?info.version.slice(0,20):'1.0',tables}}
}

function valueSchema(values:unknown[]):Record<string,unknown>{const nonNull=values.find(value=>value!==null&&value!==undefined);if(Array.isArray(nonNull))return{type:'array'};if(nonNull&&typeof nonNull==='object'){const records=values.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)) as Record<string,unknown>[],keys=[...new Set(records.flatMap(Object.keys))];return{type:'object',properties:Object.fromEntries(keys.map(key=>[key,valueSchema(records.map(record=>record[key]))])),required:keys.filter(key=>records.every(record=>record[key]!==undefined))}}if(typeof nonNull==='number')return{type:Number.isInteger(nonNull)?'integer':'number'};if(typeof nonNull==='boolean')return{type:'boolean'};return{type:'string'}}

function fromJson(value:unknown):ImportPreview {
  let tables:TableSchema[]=[]
  if(Array.isArray(value)){if(!value.length||!value.some(item=>item&&typeof item==='object'&&!Array.isArray(item)))throw new Error('JSON 数组至少需要一个对象元素');tables=[objectTable('records',valueSchema(value),0)];tables[0].count=Math.min(100_000,Math.max(20,value.length))}
  else if(value&&typeof value==='object'){const record=value as Record<string,unknown>,arrays=Object.entries(record).filter(([,item])=>Array.isArray(item)&&(item as unknown[]).some(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)));if(arrays.length)tables=arrays.slice(0,MAX_TABLES).map(([name,items],index)=>{const table=objectTable(name,valueSchema(items as unknown[]),index);table.count=Math.min(100_000,Math.max(20,(items as unknown[]).length));return table});else tables=[objectTable('records',valueSchema([record]),0)]}
  else throw new Error('JSON 根节点必须是对象或对象数组')
  connectIdReferences(tables);return{source:'json',warnings:[],project:{id:`project_${Date.now()}`,name:'JSON 样例 Mock 数据',templateId:'imported-json',description:'从 JSON 样例结构本地推断生成',seed:20250814,mode:'random',version:'1.0',tables}}
}

export function importSchemaText(raw:string):ImportPreview {
  if(new Blob([raw]).size>MAX_CONFIG_BYTES)throw new Error('Schema 文件不能超过 1 MB')
  let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error('当前支持 OpenAPI JSON 或普通 JSON，请先将 YAML 转为 JSON')}
  if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as Record<string,unknown>).openapi==='string')return fromOpenApi(value as Record<string,unknown>)
  return fromJson(value)
}

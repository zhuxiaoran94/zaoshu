import type { ProjectSchema } from '../types'

export type MockApiEnvelope='plain'|'data'|'data-meta'
export type MockApiDeletePolicy='restrict'|'cascade'
export type MockApiMethod='GET'|'POST'|'PUT'|'PATCH'|'DELETE'
export interface MockApiRouteOverride { method:MockApiMethod;path:string;latencyMinMs:number;latencyMaxMs:number;failureRate:number;failureStatus:number;failureMessage:string }
export const MAX_MOCK_ROUTE_OVERRIDES=20

export interface MockApiOptions {
  latencyMinMs:number
  latencyMaxMs:number
  failureRate:number
  failureStatus:number
  envelope:MockApiEnvelope
  validateSchema:boolean
  validateForeignKeys:boolean
  deletePolicy:MockApiDeletePolicy
  nestedRoutes:boolean
  routeOverrides:MockApiRouteOverride[]
}

export const DEFAULT_MOCK_API_OPTIONS:MockApiOptions={latencyMinMs:0,latencyMaxMs:0,failureRate:0,failureStatus:503,envelope:'plain',validateSchema:false,validateForeignKeys:true,deletePolicy:'restrict',nestedRoutes:true,routeOverrides:[]}

const bounded=(value:unknown,min:number,max:number,fallback:number)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.max(min,Math.min(max,Math.round(parsed))):fallback}
const normalizePath=(value:unknown)=>{const path=String(value??'').trim().replaceAll('{id}',':id');return path.length<=200&&/^\/api\/[A-Za-z0-9_.:/-]+$/.test(path)&&!path.includes('..')&&!path.includes('//')&&!path.startsWith('/api/__mock/')?path:null}
const normalizeMessage=(value:unknown)=>String(value??'Injected mock network failure').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,200)||'Injected mock network failure'
const normalizeRouteOverrides=(value:unknown)=>{const normalized=new Map<string,MockApiRouteOverride>();if(!Array.isArray(value))return[];for(const candidate of value.slice(0,MAX_MOCK_ROUTE_OVERRIDES)){if(!candidate||typeof candidate!=='object')continue;const item=candidate as Partial<MockApiRouteOverride>,method=String(item.method??'').toUpperCase() as MockApiMethod,path=normalizePath(item.path);if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)||!path)continue;const latencyMinMs=bounded(item.latencyMinMs,0,10_000,0),latencyMaxMs=Math.max(latencyMinMs,bounded(item.latencyMaxMs,0,10_000,latencyMinMs));normalized.set(`${method} ${path}`,{method,path,latencyMinMs,latencyMaxMs,failureRate:bounded(item.failureRate,0,100,0),failureStatus:bounded(item.failureStatus,400,599,503),failureMessage:normalizeMessage(item.failureMessage)})}return[...normalized.values()]}
export function normalizeMockApiOptions(value?:Partial<MockApiOptions>):MockApiOptions{
  const latencyMinMs=bounded(value?.latencyMinMs,0,10_000,DEFAULT_MOCK_API_OPTIONS.latencyMinMs)
  const latencyMaxMs=Math.max(latencyMinMs,bounded(value?.latencyMaxMs,0,10_000,DEFAULT_MOCK_API_OPTIONS.latencyMaxMs))
  return{latencyMinMs,latencyMaxMs,failureRate:bounded(value?.failureRate,0,100,DEFAULT_MOCK_API_OPTIONS.failureRate),failureStatus:bounded(value?.failureStatus,400,599,DEFAULT_MOCK_API_OPTIONS.failureStatus),envelope:['plain','data','data-meta'].includes(value?.envelope??'')?value!.envelope!:DEFAULT_MOCK_API_OPTIONS.envelope,validateSchema:value?.validateSchema??DEFAULT_MOCK_API_OPTIONS.validateSchema,validateForeignKeys:value?.validateForeignKeys??DEFAULT_MOCK_API_OPTIONS.validateForeignKeys,deletePolicy:['restrict','cascade'].includes(value?.deletePolicy??'')?value!.deletePolicy!:DEFAULT_MOCK_API_OPTIONS.deletePolicy,nestedRoutes:value?.nestedRoutes??DEFAULT_MOCK_API_OPTIONS.nestedRoutes,routeOverrides:normalizeRouteOverrides(value?.routeOverrides)}
}

export function mockApiRouteKeys(project:ProjectSchema,nestedRoutes=true){const keys=new Set<string>();for(const table of project.tables){const base=`/api/${table.name}`;for(const method of ['GET','POST'] as const)keys.add(`${method} ${base}`);for(const method of ['GET','PUT','PATCH','DELETE'] as const)keys.add(`${method} ${base}/:id`);for(const method of ['POST','PATCH','DELETE'] as const)keys.add(`${method} ${base}/_batch`)}if(nestedRoutes)for(const child of project.tables)for(const field of child.fields.filter(candidate=>candidate.ref)){const parent=project.tables.find(table=>table.id===field.ref!.tableId);if(!parent)continue;const duplicate=child.fields.filter(candidate=>candidate.ref?.tableId===parent.id).length>1;keys.add(`GET /api/${parent.name}/:id/${child.name}${duplicate?`/by-${field.name}`:''}`)}return keys}
export function normalizeMockApiOptionsForProject(project:ProjectSchema,value?:Partial<MockApiOptions>){const options=normalizeMockApiOptions(value),allowed=mockApiRouteKeys(project,options.nestedRoutes);return{...options,routeOverrides:options.routeOverrides.filter(rule=>allowed.has(`${rule.method} ${rule.path}`))}}

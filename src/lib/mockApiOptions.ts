export type MockApiEnvelope='plain'|'data'|'data-meta'
export type MockApiDeletePolicy='restrict'|'cascade'

export interface MockApiOptions {
  latencyMinMs:number
  latencyMaxMs:number
  failureRate:number
  failureStatus:number
  envelope:MockApiEnvelope
  validateForeignKeys:boolean
  deletePolicy:MockApiDeletePolicy
  nestedRoutes:boolean
}

export const DEFAULT_MOCK_API_OPTIONS:MockApiOptions={latencyMinMs:0,latencyMaxMs:0,failureRate:0,failureStatus:503,envelope:'plain',validateForeignKeys:true,deletePolicy:'restrict',nestedRoutes:true}

const bounded=(value:unknown,min:number,max:number,fallback:number)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.max(min,Math.min(max,Math.round(parsed))):fallback}
export function normalizeMockApiOptions(value?:Partial<MockApiOptions>):MockApiOptions{
  const latencyMinMs=bounded(value?.latencyMinMs,0,10_000,DEFAULT_MOCK_API_OPTIONS.latencyMinMs)
  const latencyMaxMs=Math.max(latencyMinMs,bounded(value?.latencyMaxMs,0,10_000,DEFAULT_MOCK_API_OPTIONS.latencyMaxMs))
  return{latencyMinMs,latencyMaxMs,failureRate:bounded(value?.failureRate,0,100,DEFAULT_MOCK_API_OPTIONS.failureRate),failureStatus:bounded(value?.failureStatus,400,599,DEFAULT_MOCK_API_OPTIONS.failureStatus),envelope:['plain','data','data-meta'].includes(value?.envelope??'')?value!.envelope!:DEFAULT_MOCK_API_OPTIONS.envelope,validateForeignKeys:value?.validateForeignKeys??DEFAULT_MOCK_API_OPTIONS.validateForeignKeys,deletePolicy:['restrict','cascade'].includes(value?.deletePolicy??'')?value!.deletePolicy!:DEFAULT_MOCK_API_OPTIONS.deletePolicy,nestedRoutes:value?.nestedRoutes??DEFAULT_MOCK_API_OPTIONS.nestedRoutes}
}

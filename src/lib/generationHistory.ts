import { del, get, set } from 'idb-keyval'
import type { GenerateResult, ProjectSchema } from '../types'
import { MAX_CONFIG_BYTES, parseProjectFile, serializeProject } from './projectConfig'

const HISTORY_KEY='mock-tool-generation-history'
export const MAX_GENERATION_HISTORY=10

export interface GenerationHistoryItem {
  id:string
  createdAt:string
  project:ProjectSchema
  totalRows:number
  duration:number
  passedChecks:number
  failedChecks:number
  coverageGaps:number
}

const validItem=(value:unknown):GenerationHistoryItem|null=>{
  if(!value||typeof value!=='object')return null
  const item=value as Partial<GenerationHistoryItem>
  if(typeof item.id!=='string'||typeof item.createdAt!=='string'||!item.project||![item.totalRows,item.duration,item.passedChecks,item.failedChecks,item.coverageGaps].every(number=>typeof number==='number'&&Number.isFinite(number)))return null
  try{const project=parseProjectFile(serializeProject(item.project));return{...item,project} as GenerationHistoryItem}catch{return null}
}

export function createGenerationHistoryItem(project:ProjectSchema,result:GenerateResult,createdAt=new Date()):GenerationHistoryItem {
  if(new Blob([serializeProject(project)]).size>MAX_CONFIG_BYTES)throw new Error('运行配置不能超过 1 MB')
  const passedChecks=result.report.checks.filter(check=>check.status==='pass').length,failedChecks=result.report.checks.filter(check=>check.status==='fail').length
  return{id:`run_${createdAt.getTime()}_${Math.random().toString(36).slice(2,8)}`,createdAt:createdAt.toISOString(),project:structuredClone(project),totalRows:result.report.totalRows,duration:result.report.duration,passedChecks,failedChecks,coverageGaps:result.report.gaps.length}
}

export const generationHistoryStore={
  async load(){if(typeof indexedDB==='undefined')return[];const raw=await get<unknown>(HISTORY_KEY);if(!Array.isArray(raw))return[];return raw.slice(0,MAX_GENERATION_HISTORY).map(validItem).filter((item):item is GenerationHistoryItem=>!!item)},
  async record(project:ProjectSchema,result:GenerateResult){if(typeof indexedDB==='undefined')return[];const current=await this.load(),next=[createGenerationHistoryItem(project,result),...current].slice(0,MAX_GENERATION_HISTORY);await set(HISTORY_KEY,next);return next},
  async remove(id:string){if(typeof indexedDB==='undefined')return[];const next=(await this.load()).filter(item=>item.id!==id);await set(HISTORY_KEY,next);return next},
  async clear(){if(typeof indexedDB!=='undefined')await del(HISTORY_KEY)},
}

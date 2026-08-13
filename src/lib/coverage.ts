import { ENUM_VALUES } from '../data/enumValues'
import type { CoverageGap, GeneratedData, ProjectSchema } from '../types'

export interface CoverageAnalysis {
  gaps: CoverageGap[]
  enumTotal: number
  enumCovered: number
  emptyTotal: number
  emptyCovered: number
  boundaryTotal: number
  boundaryCovered: number
}

const valueForType=(value:unknown,dataType:string)=>{if(dataType==='number'){const number=Number(value);return Number.isFinite(number)?number:value}if(dataType==='boolean'&&['true','false'].includes(String(value)))return String(value)==='true';return value}
const key=(value:unknown,dataType='')=>{const normalized=valueForType(value,dataType);return`${typeof normalized}:${JSON.stringify(normalized)}`}

export function analyzeCoverage(project:ProjectSchema,data:GeneratedData):CoverageAnalysis {
  const gaps:CoverageGap[]=[]
  let enumTotal=0,enumCovered=0,emptyTotal=0,emptyCovered=0,boundaryTotal=0,boundaryCovered=0
  for(const table of project.tables){
    const rows=data[table.id]||[]
    for(const field of table.fields){
      const present=rows.filter(row=>Object.prototype.hasOwnProperty.call(row,field.name)),values=present.map(row=>row[field.name]),seen=new Set(values.map(value=>key(value,field.dataType)))
      const candidates=field.values?.length?field.values:ENUM_VALUES[field.generator]
      if(candidates?.length&&!field.formula&&!field.condition&&!field.ref&&!field.prefix&&!field.suffix&&!field.unique&&!field.primaryKey){
        const missing=candidates.filter(value=>!seen.has(key(value,field.dataType)));enumTotal+=candidates.length;enumCovered+=candidates.length-missing.length
        if(missing.length)gaps.push({id:`enum-${field.id}`,kind:'enum',tableId:table.id,fieldId:field.id,label:`${table.label}.${field.label} 枚举值`,detail:`缺少 ${missing.length}/${candidates.length} 个候选值`,missingValues:missing.map(value=>valueForType(value,field.dataType))})
      }
      if((field.nullable||0)>0&&!field.primaryKey&&!field.unique&&!field.formula&&!field.condition){emptyTotal++;if(values.some(value=>value===null)){emptyCovered++}else gaps.push({id:`null-${field.id}`,kind:'null',tableId:table.id,fieldId:field.id,label:`${table.label}.${field.label} NULL`,detail:'已配置空值率，但结果中没有 NULL',missingValues:[null]})}
      if((field.missing||0)>0&&!field.primaryKey&&!field.unique&&!field.formula&&!field.condition){emptyTotal++;if(present.length<rows.length){emptyCovered++}else gaps.push({id:`missing-${field.id}`,kind:'missing',tableId:table.id,fieldId:field.id,label:`${table.label}.${field.label} 字段缺失`,detail:'已配置缺失率，但每条记录都包含该字段',missingValues:[undefined]})}
      if(field.dataType==='number'&&!field.formula&&!field.condition&&!field.ref&&!field.unique&&!field.primaryKey){
        const expected=[field.min,field.max].filter((value,index,list):value is number=>value!==undefined&&list.indexOf(value)===index)
        if(expected.length){const missing=expected.filter(value=>!seen.has(key(value,field.dataType)));boundaryTotal+=expected.length;boundaryCovered+=expected.length-missing.length;if(missing.length)gaps.push({id:`boundary-${field.id}`,kind:'boundary',tableId:table.id,fieldId:field.id,label:`${table.label}.${field.label} 数值边界`,detail:`缺少边界值 ${missing.join('、')}`,missingValues:missing})}
      }
    }
  }
  return{gaps,enumTotal,enumCovered,emptyTotal,emptyCovered,boundaryTotal,boundaryCovered}
}

export const coveragePercentage=(covered:number,total:number)=>total?Math.round(covered/total*100):100

import type { DataRow, TableSchema } from '../types'

export interface FieldStatistic { fieldId:string; name:string; label:string; total:number; missing:number; nulls:number; unique:number; uniqueRate:number; min?:string; max?:string; topValues:Array<{value:string;count:number}> }

const comparable=(value:unknown,type:TableSchema['fields'][number]['dataType'])=>{if(type==='number'){const number=Number(value);return Number.isFinite(number)?number:undefined}if(type==='date'){const time=new Date(String(value)).getTime();return Number.isFinite(time)?time:undefined}return undefined}

export function analyzeTableFields(table:TableSchema,rows:DataRow[]):FieldStatistic[]{return table.fields.map(field=>{
  const present=rows.filter(row=>Object.prototype.hasOwnProperty.call(row,field.name)),values=present.map(row=>row[field.name]).filter(value=>value!==null&&value!==undefined),serialized=values.map(value=>typeof value==='object'?JSON.stringify(value):String(value)),counts=new Map<string,number>();serialized.forEach(value=>counts.set(value,(counts.get(value)||0)+1));const comparableValues=values.map(value=>comparable(value,field.dataType)).filter((value):value is number=>value!==undefined),format=(value:number)=>field.dataType==='date'?new Date(value).toISOString():String(value)
  return{fieldId:field.id,name:field.name,label:field.label,total:rows.length,missing:rows.length-present.length,nulls:present.filter(row=>row[field.name]===null).length,unique:new Set(serialized).size,uniqueRate:serialized.length?Math.round(new Set(serialized).size/serialized.length*100):0,min:comparableValues.length?format(Math.min(...comparableValues)):undefined,max:comparableValues.length?format(Math.max(...comparableValues)):undefined,topValues:[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([value,count])=>({value,count}))}
})}

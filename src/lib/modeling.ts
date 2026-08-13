import type { GenerateResult, GeneratedData, ProjectSchema, QualityCheck, TableSchema } from '../types'
import { analyzeCoverage, coveragePercentage } from './coverage'
import { ENUM_VALUES } from '../data/enumValues'

const issueRows=(indexes:number[])=>({rowIndexes:indexes.slice(0,200),issueCount:indexes.length})
const expectedStatus=(project:ProjectSchema,invalid:number):QualityCheck['status']=>invalid===0?'pass':project.mode==='boundary'||project.mode==='exception'?'expected':'fail'
const validType=(value:unknown,type:string)=>type==='number'?typeof value==='number'&&Number.isFinite(value):type==='boolean'?typeof value==='boolean':type==='object'?typeof value==='object'&&value!==null:type==='date'?typeof value==='string'&&Number.isFinite(Date.parse(value)):typeof value==='string'
const enumValue=(value:unknown,dataType:string)=>{if(dataType==='number'){const number=Number(value);return Number.isFinite(number)?number:value}if(dataType==='boolean'&&['true','false'].includes(String(value)))return String(value)==='true';return value}
const enumKey=(value:unknown,dataType:string)=>{const normalized=enumValue(value,dataType);return`${typeof normalized}:${JSON.stringify(normalized)}`}

export function sortTables(tables:TableSchema[]) {
  const result:TableSchema[]=[]; const visiting=new Set<string>(); const visited=new Set<string>()
  const byId=new Map(tables.map(t=>[t.id,t]))
  const visit=(table:TableSchema) => {
    if(visiting.has(table.id)) throw new Error(`检测到循环依赖：${table.label}`)
    if(visited.has(table.id)) return
    visiting.add(table.id)
    table.fields.forEach(field=>{ if(field.ref) { const parent=byId.get(field.ref.tableId); if(parent) visit(parent) } })
    visiting.delete(table.id); visited.add(table.id); result.push(table)
  }
  tables.forEach(visit); return result
}

export function validate(project:ProjectSchema,data:GeneratedData):QualityCheck[] {
  const checks:QualityCheck[]=[]
  for(const table of project.tables) {
    const rows=data[table.id]||[]
    checks.push({id:`count-${table.id}`,label:`${table.label} 数据量`,status:rows.length===table.count?'pass':'fail',detail:`期望 ${table.count} 条，实际 ${rows.length} 条`,tableId:table.id})
    for(const field of table.fields) {
      const values=rows.map(r=>r[field.name]).filter(v=>v!==undefined&&v!==null)
      const required=field.condition?[]:rows.map((row,index)=>({row,index})).filter(({row})=>(field.missing??0)===0&&!Object.prototype.hasOwnProperty.call(row,field.name)||(field.nullable??0)===0&&row[field.name]===null).map(item=>item.index);checks.push({id:`required-${field.id}`,label:`${table.label}.${field.label} 必填`,status:expectedStatus(project,required.length),detail:field.condition?'由条件规则控制是否必填':required.length?`${required.length} 条记录缺失或为 NULL`:'必填记录均有值',tableId:table.id,fieldId:field.id,...issueRows(required)})
      const invalidTypes=rows.map((row,index)=>({value:row[field.name],index})).filter(item=>item.value!==undefined&&item.value!==null&&!validType(item.value,field.dataType)).map(item=>item.index);checks.push({id:`type-${field.id}`,label:`${table.label}.${field.label} 类型`,status:expectedStatus(project,invalidTypes.length),detail:invalidTypes.length?`${invalidTypes.length} 条记录类型错误`:`全部符合 ${field.dataType} 类型`,tableId:table.id,fieldId:field.id,...issueRows(invalidTypes)})
      if(field.unique||field.primaryKey) { const seen=new Set<unknown>(),duplicates=rows.map((row,index)=>({value:row[field.name],index})).filter(item=>item.value!==undefined&&item.value!==null&&(seen.has(item.value)||!seen.add(item.value))).map(item=>item.index); checks.push({id:`unique-${field.id}`,label:`${table.label}.${field.label} 唯一性`,status:duplicates.length?'fail':'pass',detail:duplicates.length?`发现 ${duplicates.length} 个重复值`:'无重复值',tableId:table.id,fieldId:field.id,...issueRows(duplicates)}) }
      if(field.ref) { const parents=new Set((data[field.ref.tableId]||[]).map(r=>r[field.ref!.field])),invalidRows=rows.map((row,index)=>({value:row[field.name],index})).filter(item=>item.value!==undefined&&item.value!==null&&!parents.has(item.value)).map(item=>item.index); checks.push({id:`fk-${field.id}`,label:`${table.label}.${field.label} 引用完整性`,status:invalidRows.length===0?'pass':project.mode==='exception'?'expected':'fail',detail:invalidRows.length?`${invalidRows.length} 个无效引用`:'所有引用均有效',tableId:table.id,fieldId:field.id,...issueRows(invalidRows)}) }
      if(field.min!==undefined||field.max!==undefined) { const invalidRows=rows.map((row,index)=>({value:row[field.name],index})).filter(item=>typeof item.value==='number'&&((field.min!==undefined&&item.value<field.min)||(field.max!==undefined&&item.value>field.max))).map(item=>item.index); checks.push({id:`range-${field.id}`,label:`${table.label}.${field.label} 范围`,status:expectedStatus(project,invalidRows.length),detail:invalidRows.length?`${invalidRows.length} 条数据越界`:'全部位于配置范围内',tableId:table.id,fieldId:field.id,...issueRows(invalidRows)}) }
      if(field.length!==undefined){const invalidRows=rows.map((row,index)=>({value:row[field.name],index})).filter(item=>typeof item.value==='string'&&item.value.length>field.length!).map(item=>item.index);checks.push({id:`length-${field.id}`,label:`${table.label}.${field.label} 长度`,status:expectedStatus(project,invalidRows.length),detail:invalidRows.length?`${invalidRows.length} 条文本超过 ${field.length} 字符`:`文本均不超过 ${field.length} 字符`,tableId:table.id,fieldId:field.id,...issueRows(invalidRows)})}
      const candidates=field.values?.length?field.values:ENUM_VALUES[field.generator];if(candidates?.length&&!field.prefix&&!field.suffix){const allowed=new Set(candidates.map(value=>enumKey(value,field.dataType))),invalidRows=rows.map((row,index)=>({value:row[field.name],index})).filter(item=>item.value!==undefined&&item.value!==null&&!allowed.has(enumKey(item.value,field.dataType))).map(item=>item.index);checks.push({id:`enum-${field.id}`,label:`${table.label}.${field.label} 枚举`,status:expectedStatus(project,invalidRows.length),detail:invalidRows.length?`${invalidRows.length} 条记录不在候选值中`:`全部属于 ${candidates.length} 个候选值`,tableId:table.id,fieldId:field.id,...issueRows(invalidRows)})}
    }
  }
  const abnormal=Object.values(data).flat().filter(r=>r._mock_meta).length
  if(project.mode==='exception') checks.push({id:'abnormal-rate',label:'异常注入',status:abnormal?'expected':'warning',detail:`已注入 ${abnormal} 条可追溯异常`})
  return checks
}

export function refreshGeneratedResult(project:ProjectSchema,result:GenerateResult,data:GeneratedData):GenerateResult {
  const checks=validate(project,data),all=Object.values(data).flat(),abnormal=all.filter(row=>row._mock_meta).length
  const analysis=analyzeCoverage(project,data),coverage=result.report.coverage.map(item=>item.label==='约束通过率'?{...item,value:Math.round(checks.filter(check=>check.status==='pass').length/Math.max(1,checks.length)*100),detail:`${checks.filter(check=>check.status==='pass').length}/${checks.length} 项检查通过`}:item.label==='枚举值覆盖'?{...item,value:coveragePercentage(analysis.enumCovered,analysis.enumTotal),detail:analysis.enumTotal?`${analysis.enumCovered}/${analysis.enumTotal} 个候选值已出现`:'当前项目没有可审计枚举字段'}:item.label==='空值场景覆盖'?{...item,value:coveragePercentage(analysis.emptyCovered,analysis.emptyTotal),detail:analysis.emptyTotal?`${analysis.emptyCovered}/${analysis.emptyTotal} 个 NULL/缺失规则已命中`:'当前项目未配置空值或缺失率'}:item.label==='数值边界覆盖'?{...item,value:coveragePercentage(analysis.boundaryCovered,analysis.boundaryTotal),detail:analysis.boundaryTotal?`${analysis.boundaryCovered}/${analysis.boundaryTotal} 个最小/最大值已出现`:'当前项目没有显式数值边界'}:item)
  return{data,report:{...result.report,totalRows:all.length,normalRows:all.length-abnormal,abnormalRows:abnormal,checks,coverage,gaps:analysis.gaps}}
}

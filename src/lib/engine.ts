import type { ConditionOperator, CoverageGap, DataMode, DataRow, FieldRule, GenerateResult, GeneratedData, ProjectSchema } from '../types'
import { generateValue, reseed } from '../data/generators'
import { sortTables, validate } from './modeling'
import { analyzeCoverage, coveragePercentage } from './coverage'
import { evaluateFormula, orderFormulaFields } from './formula'
export { refreshGeneratedResult, sortTables, validate } from './modeling'

function hash(value:string) { let h=2166136261; for(const c of value) { h ^= c.charCodeAt(0); h=Math.imul(h,16777619) } return h>>>0 }
function seeded(seed:number) { let s=seed>>>0; return () => { s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296 } }

function boundaryValue(field:FieldRule,index:number):unknown {
  const values = field.dataType==='number'
    ? [(field.min??0)-1,field.min??0,(field.min??0)+1,(field.max??100)-1,field.max??100,(field.max??100)+1,null]
    : ['',null,'a',(field.prefix||'')+'测'.repeat(Math.min(field.length??32,256)),`边界_${index}`]
  return values[index%values.length]
}

const mutations = [
  {name:'missing',label:'字段缺失',expected:'接口应返回必填字段错误'},
  {name:'wrong_type',label:'错误数据类型',expected:'接口应拒绝错误的数据类型'},
  {name:'above_maximum',label:'数值越界',expected:'接口应返回数值超限错误'},
  {name:'too_long',label:'文本超长',expected:'接口应返回长度超限错误'},
  {name:'illegal_enum',label:'非法枚举',expected:'接口应返回枚举校验错误'},
  {name:'special_chars',label:'特殊字符',expected:'系统应正确转义或拒绝危险字符'},
  {name:'null',label:'空值',expected:'接口应按字段空值规则处理'},
]

function mutate(row:DataRow,field:FieldRule,index:number) {
  const mutation=mutations[index%mutations.length]
  if(mutation.name==='missing') delete row[field.name]
  else if(mutation.name==='wrong_type') row[field.name]=field.dataType==='number'?'NOT_A_NUMBER':999999
  else if(mutation.name==='above_maximum') row[field.name]=(field.max??Number.MAX_SAFE_INTEGER)+1
  else if(mutation.name==='too_long') row[field.name]='超'.repeat(Math.min((field.length??64)+1,512))
  else if(mutation.name==='illegal_enum') row[field.name]='__INVALID_ENUM__'
  else if(mutation.name==='special_chars') row[field.name]=`' OR 1=1 -- <script>alert(1)</script>`
  else row[field.name]=null
  row._mock_meta={field:field.name,rule:field.generator,mutation:mutation.name,expected:mutation.expected}
}

function compareCondition(left: unknown, operator: ConditionOperator, right = '') {
  const empty = left === undefined || left === null || left === ''
  if (operator === 'empty') return empty
  if (operator === 'notEmpty') return !empty
  if (operator === 'equals') return String(left ?? '') === right
  if (operator === 'notEquals') return String(left ?? '') !== right
  if (operator === 'contains') return String(left ?? '').includes(right)
  const leftNumber = Number(left); const rightNumber = Number(right)
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false
  return operator === 'greaterThan' ? leftNumber > rightNumber : leftNumber < rightNumber
}

export function matchesFieldCondition(field: FieldRule, row: DataRow) {
  const condition = field.condition
  if (!condition?.rules.length) return true
  const matches = condition.rules.map(rule => compareCondition(row[rule.field], rule.operator, rule.value))
  return condition.combinator === 'or' ? matches.some(Boolean) : matches.every(Boolean)
}

function modeValue(field:FieldRule,rowIndex:number,mode:DataMode,pools:Record<string,string[]>,totalRows=1) {
  if(mode==='boundary') return boundaryValue(field,rowIndex)
  return generateValue(field,rowIndex,pools,{mode,totalRows})
}

export function generateProject(project:ProjectSchema,pools:Record<string,string[]>={}):GenerateResult {
  const started=performance.now(); reseed(project.seed); const random=seeded(project.seed); const data:GeneratedData={}; const sorted=sortTables(project.tables)
  for(const table of sorted) {
    const rows:DataRow[]=[]; const uniqueMap=new Map<string,Set<unknown>>()
    for(let i=0;i<table.count;i++) {
      const row:DataRow={}
      for(const field of table.fields) {
        if(field.missing && random()*100<field.missing) continue
        let value:unknown
        if(field.ref) {
          const parent=data[field.ref.tableId]||[]
          value=parent.length ? parent[Math.floor(random()*parent.length)][field.ref.field] : null
        } else value=modeValue(field,i,project.mode,pools,table.count)
        if(field.nullable && random()*100<field.nullable) value=null
        if(field.unique) {
          const used=uniqueMap.get(field.name)??new Set(); let tries=0
          while(used.has(value)&&tries++<50) value=modeValue(field,i+tries+hash(field.id),project.mode,pools,table.count)
          used.add(value); uniqueMap.set(field.name,used)
        }
        if(field.prefix&&value!=null) value=field.prefix+value
        if(field.suffix&&value!=null) value=String(value)+field.suffix
        row[field.name]=value
      }
      orderFormulaFields(table.fields).forEach(f=>{row[f.name]=evaluateFormula(f.formula!,row)})
      table.fields.filter(f=>f.condition&&!matchesFieldCondition(f,row)).forEach(f=>{if(f.condition!.otherwise==='omit')delete row[f.name];else row[f.name]=null})
      if(project.mode==='exception' && (i%5===0 || table.fields.some(f=>f.abnormal && random()*100<f.abnormal))) {
        const target=table.fields.filter(f=>!f.primaryKey)[i%Math.max(1,table.fields.filter(f=>!f.primaryKey).length)]??table.fields[0]
        mutate(row,target,i)
      }
      rows.push(row)
    }
    data[table.id]=rows
  }
  const checks=validate(project,data)
  const all=Object.values(data).flat(); const abnormal=all.filter(r=>r._mock_meta).length
  const distributionFields=project.tables.flatMap(t=>t.fields).filter(f=>f.distribution||f.weights?.length)
  const analysis=analyzeCoverage(project,data)
  const coverage=[
    {label:'字段生成覆盖',value:100,detail:`${project.tables.reduce((n,t)=>n+t.fields.length,0)} 个字段已生成`},
    {label:'约束通过率',value:Math.round(checks.filter(c=>c.status==='pass').length/Math.max(1,checks.length)*100),detail:`${checks.filter(c=>c.status==='pass').length}/${checks.length} 项检查通过`},
    {label:'枚举值覆盖',value:coveragePercentage(analysis.enumCovered,analysis.enumTotal),detail:analysis.enumTotal?`${analysis.enumCovered}/${analysis.enumTotal} 个候选值已出现`:`当前项目没有可审计枚举字段`},
    {label:'空值场景覆盖',value:coveragePercentage(analysis.emptyCovered,analysis.emptyTotal),detail:analysis.emptyTotal?`${analysis.emptyCovered}/${analysis.emptyTotal} 个 NULL/缺失规则已命中`:'当前项目未配置空值或缺失率'},
    {label:'数值边界覆盖',value:coveragePercentage(analysis.boundaryCovered,analysis.boundaryTotal),detail:analysis.boundaryTotal?`${analysis.boundaryCovered}/${analysis.boundaryTotal} 个最小/最大值已出现`:'当前项目没有显式数值边界'},
    {label:'真实分布配置',value:project.mode==='realistic'?(distributionFields.length?100:60):0,detail:project.mode==='realistic'?`${distributionFields.length} 个字段使用业务权重或趋势配置`:'切换到真实分布模式后统计'},
    {label:'异常策略覆盖',value:project.mode==='exception'?Math.min(100,Math.round(abnormal/7*100)):0,detail:`命中 ${abnormal} 条异常数据`},
  ]
  return {data,report:{duration:Math.round(performance.now()-started),totalRows:all.length,normalRows:all.length-abnormal,abnormalRows:abnormal,checks,coverage,gaps:analysis.gaps,generatedAt:new Date().toISOString()}}
}

export function supplementCoverageGaps(project:ProjectSchema,data:GeneratedData,pools:Record<string,string[]>={},selectedGaps?:CoverageGap[]){
  const gaps=selectedGaps??analyzeCoverage(project,data).gaps,nextData:GeneratedData=structuredClone(data),addedByTable:Record<string,number>={}
  for(const table of sortTables(project.tables)){
    const tableGaps=gaps.filter(gap=>gap.tableId===table.id),fieldOffsets=new Map<string,number>(),scheduled=tableGaps.map(gap=>{const start=fieldOffsets.get(gap.fieldId)??0;fieldOffsets.set(gap.fieldId,start+gap.missingValues.length);return{gap,start}}),needed=Math.max(0,...fieldOffsets.values());if(!needed)continue
    const rows=nextData[table.id]||[],uniqueMap=new Map(table.fields.filter(field=>field.unique||field.primaryKey).map(field=>[field.name,new Set(rows.map(row=>row[field.name]))]))
    reseed((project.seed+hash(table.id)+rows.length)>>>0);const random=seeded((project.seed^hash(table.id)^rows.length)>>>0)
    for(let offset=0;offset<needed;offset++){
      const rowIndex=rows.length,row:DataRow={}
      for(const field of table.fields){
        let value:unknown
        if(field.ref){const parent=nextData[field.ref.tableId]||[];value=parent.length?parent[Math.floor(random()*parent.length)][field.ref.field]:null}else value=modeValue(field,rowIndex,project.mode,pools,rows.length+needed)
        if(field.unique||field.primaryKey){const used=uniqueMap.get(field.name)??new Set<unknown>();let tries=0;while(used.has(value)&&tries++<100)value=modeValue(field,rowIndex+tries+hash(field.id),project.mode,pools,rows.length+needed);used.add(value);uniqueMap.set(field.name,used)}
        if(field.prefix&&value!=null)value=field.prefix+value;if(field.suffix&&value!=null)value=String(value)+field.suffix;row[field.name]=value
      }
      for(const{gap,start}of scheduled){const valueIndex=offset-start;if(valueIndex<0||valueIndex>=gap.missingValues.length)continue;const field=table.fields.find(candidate=>candidate.id===gap.fieldId);if(!field)continue;if(gap.kind==='missing')delete row[field.name];else row[field.name]=gap.missingValues[valueIndex]}
      orderFormulaFields(table.fields).forEach(field=>{row[field.name]=evaluateFormula(field.formula!,row)})
      table.fields.filter(field=>field.condition&&!matchesFieldCondition(field,row)).forEach(field=>{if(field.condition!.otherwise==='omit')delete row[field.name];else row[field.name]=null})
      rows.push(row)
    }
    nextData[table.id]=rows;addedByTable[table.id]=needed
  }
  const nextProject={...project,tables:project.tables.map(table=>addedByTable[table.id]?{...table,count:(nextData[table.id]||[]).length}:table)}
  return{project:nextProject,data:nextData,added:Object.values(addedByTable).reduce((sum,count)=>sum+count,0)}
}

export function regenerateDataRow(project:ProjectSchema,data:GeneratedData,tableId:string,rowIndex:number,pools:Record<string,string[]>={},lockedFields:string[]=[],nonce=Date.now()):DataRow {
  const table=project.tables.find(candidate=>candidate.id===tableId);if(!table)throw new Error('要重新生成的数据表不存在')
  const original=data[tableId]?.[rowIndex]||{},locked=new Set([...lockedFields,...table.fields.filter(field=>field.primaryKey).map(field=>field.name)]),row:DataRow={}
  reseed((project.seed+hash(tableId)+rowIndex+nonce)>>>0);const random=seeded((project.seed^hash(tableId)^rowIndex^nonce)>>>0)
  for(const field of table.fields){
    if(locked.has(field.name)){if(Object.prototype.hasOwnProperty.call(original,field.name))row[field.name]=original[field.name];continue}
    if(field.missing&&random()*100<field.missing)continue
    let value:unknown
    if(field.ref){const parent=data[field.ref.tableId]||[];value=parent.length?parent[Math.floor(random()*parent.length)][field.ref.field]:null}else value=modeValue(field,rowIndex+nonce%10_000,project.mode,pools,table.count)
    if(field.nullable&&random()*100<field.nullable)value=null
    if(field.unique){const used=new Set((data[tableId]||[]).filter((_,index)=>index!==rowIndex).map(candidate=>candidate[field.name]));let tries=0;while(used.has(value)&&tries++<100)value=modeValue(field,rowIndex+nonce%10_000+tries+hash(field.id),project.mode,pools,table.count)}
    if(field.prefix&&value!=null)value=field.prefix+value;if(field.suffix&&value!=null)value=String(value)+field.suffix;row[field.name]=value
  }
  orderFormulaFields(table.fields).filter(field=>!locked.has(field.name)).forEach(field=>{row[field.name]=evaluateFormula(field.formula!,row)})
  table.fields.filter(field=>field.condition&&!matchesFieldCondition(field,row)&&!locked.has(field.name)).forEach(field=>{if(field.condition!.otherwise==='omit')delete row[field.name];else row[field.name]=null})
  if(project.mode==='exception'){const candidates=table.fields.filter(field=>!field.primaryKey&&!locked.has(field.name));if(candidates.length)mutate(row,candidates[rowIndex%candidates.length],rowIndex)}
  return row
}

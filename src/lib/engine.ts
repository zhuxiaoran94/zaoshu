import type { ConditionOperator, DataMode, DataRow, FieldRule, GenerateResult, GeneratedData, ProjectSchema, QualityCheck, TableSchema } from '../types'
import { generateValue, reseed } from '../data/generators'

function hash(value:string) { let h=2166136261; for(const c of value) { h ^= c.charCodeAt(0); h=Math.imul(h,16777619) } return h>>>0 }
function seeded(seed:number) { let s=seed>>>0; return () => { s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296 } }

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

function resolveFormula(formula:string,row:DataRow):unknown {
  const expression=formula.trim()
  const round=expression.match(/^round\((\w+)\s*\*\s*(\w+)(?:\s*-\s*(\w+))?,\s*(\d)\)$/)
  if(round) { const value=Number(row[round[1]])*Number(row[round[2]])-(round[3]?Number(row[round[3]]):0); return Number(value.toFixed(Number(round[4]))) }
  const concat=expression.split('+').map(x=>x.trim())
  if(concat.length>1) return concat.map(x=>String(row[x]??x.replace(/^['"]|['"]$/g,''))).join('')
  return row[expression] ?? null
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

function modeValue(field:FieldRule,rowIndex:number,mode:DataMode,pools:Record<string,string[]>) {
  if(mode==='boundary') return boundaryValue(field,rowIndex)
  return generateValue(field,rowIndex,pools)
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
        } else value=modeValue(field,i,project.mode,pools)
        if(field.nullable && random()*100<field.nullable) value=null
        if(field.unique) {
          const used=uniqueMap.get(field.name)??new Set(); let tries=0
          while(used.has(value)&&tries++<50) value=modeValue(field,i+tries+hash(field.id),project.mode,pools)
          used.add(value); uniqueMap.set(field.name,used)
        }
        if(field.prefix&&value!=null) value=field.prefix+value
        if(field.suffix&&value!=null) value=String(value)+field.suffix
        row[field.name]=value
      }
      table.fields.filter(f=>f.formula).forEach(f=>{row[f.name]=resolveFormula(f.formula!,row)})
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
  const enumFields=project.tables.flatMap(t=>t.fields).filter(f=>f.values?.length||['userStatus','orderStatus','transactionStatus','questStatus','logisticsStatus'].includes(f.generator))
  const coverage=[
    {label:'字段生成覆盖',value:100,detail:`${project.tables.reduce((n,t)=>n+t.fields.length,0)} 个字段已生成`},
    {label:'约束通过率',value:Math.round(checks.filter(c=>c.status==='pass').length/Math.max(1,checks.length)*100),detail:`${checks.filter(c=>c.status==='pass').length}/${checks.length} 项检查通过`},
    {label:'枚举覆盖',value:enumFields.length?Math.min(100,65+enumFields.length*4):100,detail:`覆盖 ${enumFields.length} 个枚举字段`},
    {label:'异常策略覆盖',value:project.mode==='exception'?Math.min(100,Math.round(abnormal/7*100)):0,detail:`命中 ${abnormal} 条异常数据`},
  ]
  return {data,report:{duration:Math.round(performance.now()-started),totalRows:all.length,normalRows:all.length-abnormal,abnormalRows:abnormal,checks,coverage,generatedAt:new Date().toISOString()}}
}

export function refreshGeneratedResult(project:ProjectSchema,result:GenerateResult,data:GeneratedData):GenerateResult {
  const checks=validate(project,data),all=Object.values(data).flat(),abnormal=all.filter(row=>row._mock_meta).length
  const coverage=result.report.coverage.map(item=>item.label==='约束通过率'?{...item,value:Math.round(checks.filter(check=>check.status==='pass').length/Math.max(1,checks.length)*100),detail:`${checks.filter(check=>check.status==='pass').length}/${checks.length} 项检查通过`}:item)
  return{data,report:{...result.report,totalRows:all.length,normalRows:all.length-abnormal,abnormalRows:abnormal,checks,coverage}}
}

export function regenerateDataRow(project:ProjectSchema,data:GeneratedData,tableId:string,rowIndex:number,pools:Record<string,string[]>={},lockedFields:string[]=[],nonce=Date.now()):DataRow {
  const table=project.tables.find(candidate=>candidate.id===tableId);if(!table)throw new Error('要重新生成的数据表不存在')
  const original=data[tableId]?.[rowIndex]||{},locked=new Set([...lockedFields,...table.fields.filter(field=>field.primaryKey).map(field=>field.name)]),row:DataRow={}
  reseed((project.seed+hash(tableId)+rowIndex+nonce)>>>0);const random=seeded((project.seed^hash(tableId)^rowIndex^nonce)>>>0)
  for(const field of table.fields){
    if(locked.has(field.name)){if(Object.prototype.hasOwnProperty.call(original,field.name))row[field.name]=original[field.name];continue}
    if(field.missing&&random()*100<field.missing)continue
    let value:unknown
    if(field.ref){const parent=data[field.ref.tableId]||[];value=parent.length?parent[Math.floor(random()*parent.length)][field.ref.field]:null}else value=modeValue(field,rowIndex+nonce%10_000,project.mode,pools)
    if(field.nullable&&random()*100<field.nullable)value=null
    if(field.unique){const used=new Set((data[tableId]||[]).filter((_,index)=>index!==rowIndex).map(candidate=>candidate[field.name]));let tries=0;while(used.has(value)&&tries++<100)value=modeValue(field,rowIndex+nonce%10_000+tries+hash(field.id),project.mode,pools)}
    if(field.prefix&&value!=null)value=field.prefix+value;if(field.suffix&&value!=null)value=String(value)+field.suffix;row[field.name]=value
  }
  table.fields.filter(field=>field.formula&&!locked.has(field.name)).forEach(field=>{row[field.name]=resolveFormula(field.formula!,row)})
  table.fields.filter(field=>field.condition&&!matchesFieldCondition(field,row)&&!locked.has(field.name)).forEach(field=>{if(field.condition!.otherwise==='omit')delete row[field.name];else row[field.name]=null})
  if(project.mode==='exception'){const candidates=table.fields.filter(field=>!field.primaryKey&&!locked.has(field.name));if(candidates.length)mutate(row,candidates[rowIndex%candidates.length],rowIndex)}
  return row
}

export function validate(project:ProjectSchema,data:GeneratedData):QualityCheck[] {
  const checks:QualityCheck[]=[]
  for(const table of project.tables) {
    const rows=data[table.id]||[]
    checks.push({id:`count-${table.id}`,label:`${table.label} 数据量`,status:rows.length===table.count?'pass':'fail',detail:`期望 ${table.count} 条，实际 ${rows.length} 条`,tableId:table.id})
    for(const field of table.fields) {
      const values=rows.map(r=>r[field.name]).filter(v=>v!==undefined&&v!==null)
      if(field.unique||field.primaryKey) { const ok=new Set(values).size===values.length; checks.push({id:`unique-${field.id}`,label:`${table.label}.${field.label} 唯一性`,status:ok?'pass':'fail',detail:ok?'无重复值':`发现 ${values.length-new Set(values).size} 个重复值`,tableId:table.id}) }
      if(field.ref) { const parents=new Set((data[field.ref.tableId]||[]).map(r=>r[field.ref!.field])); const invalid=values.filter(v=>!parents.has(v)).length; checks.push({id:`fk-${field.id}`,label:`${table.label}.${field.label} 引用完整性`,status:invalid===0?'pass':project.mode==='exception'?'expected':'fail',detail:invalid?`${invalid} 个无效引用`:'所有引用均有效',tableId:table.id}) }
      if(field.min!==undefined||field.max!==undefined) { const invalid=values.filter(v=>typeof v==='number'&&((field.min!==undefined&&v<field.min)||(field.max!==undefined&&v>field.max))).length; checks.push({id:`range-${field.id}`,label:`${table.label}.${field.label} 范围`,status:invalid===0?'pass':project.mode==='boundary'||project.mode==='exception'?'expected':'fail',detail:invalid?`${invalid} 条数据越界`:'全部位于配置范围内',tableId:table.id}) }
    }
  }
  const abnormal=Object.values(data).flat().filter(r=>r._mock_meta).length
  if(project.mode==='exception') checks.push({id:'abnormal-rate',label:'异常注入',status:abnormal?'expected':'warning',detail:`已注入 ${abnormal} 条可追溯异常`})
  return checks
}

export interface PairwiseConfig { name:string; values:string[] }
export type PairwiseRule = Record<string,string>

export function parsePairwiseRules(text:string,dimensions:PairwiseConfig[]):PairwiseRule[] {
  if(text.length>20_000)throw new Error('组合规则文本不能超过 20,000 个字符')
  const byName=new Map(dimensions.map(dimension=>[dimension.name,dimension.values]))
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);if(lines.length>100)throw new Error('组合规则最多 100 行')
  return lines.map((line,index)=>{
    const rule:PairwiseRule={}
    for(const token of line.split(/[,，]/).map(item=>item.trim()).filter(Boolean)){
      const separator=token.indexOf('=');if(separator<1)throw new Error(`第 ${index+1} 行格式错误，请使用“维度=值”`)
      const name=token.slice(0,separator).trim(),value=token.slice(separator+1).trim(),values=byName.get(name)
      if(!values)throw new Error(`第 ${index+1} 行包含未知维度：${name}`)
      if(!values.includes(value))throw new Error(`第 ${index+1} 行的 ${name} 不包含候选值：${value}`)
      rule[name]=value
    }
    if(!Object.keys(rule).length)throw new Error(`第 ${index+1} 行没有有效条件`)
    return rule
  })
}

const pairKey=(a:number,av:string,b:number,bv:string)=>JSON.stringify([a,av,b,bv])
const isExcluded=(row:PairwiseRule,exclusions:PairwiseRule[])=>exclusions.some(rule=>Object.keys(rule).length>0&&Object.entries(rule).every(([key,value])=>row[key]===value))
const rowPairs=(dimensions:PairwiseConfig[],row:PairwiseRule)=>{const pairs:string[]=[];for(let i=0;i<dimensions.length;i++)for(let j=i+1;j<dimensions.length;j++)pairs.push(pairKey(i,row[dimensions[i].name],j,row[dimensions[j].name]));return pairs}
const completeCombination=(partial:PairwiseRule,dimensions:PairwiseConfig[],exclusions:PairwiseRule[],uncovered?:Set<string>):PairwiseRule|null=>{
  if(isExcluded(partial,exclusions))return null
  const next=dimensions.findIndex(dimension=>partial[dimension.name]===undefined)
  if(next<0)return partial
  const dimension=dimensions[next]
  const assigned=dimensions.map((candidate,index)=>({candidate,index})).filter(({candidate})=>partial[candidate.name]!==undefined)
  const values=[...dimension.values].sort((a,b)=>{const score=(value:string)=>assigned.reduce((sum,{candidate,index})=>{const left=Math.min(index,next),right=Math.max(index,next);const leftValue=index<next?partial[candidate.name]:value,rightValue=index<next?value:partial[candidate.name];return sum+(uncovered?.has(pairKey(left,leftValue,right,rightValue))?1:0)},0);return score(b)-score(a)})
  for(const value of values){const completed=completeCombination({...partial,[dimension.name]:value},dimensions,exclusions,uncovered);if(completed)return completed}
  return null
}

const possiblePairs=(dimensions:PairwiseConfig[],exclusions:PairwiseRule[])=>{
  const pairs=new Set<string>()
  for(let i=0;i<dimensions.length;i++)for(let j=i+1;j<dimensions.length;j++)for(const a of dimensions[i].values)for(const b of dimensions[j].values){const partial={[dimensions[i].name]:a,[dimensions[j].name]:b};if(completeCombination(partial,dimensions,exclusions))pairs.add(pairKey(i,a,j,b))}
  return pairs
}

export function analyzePairwiseCoverage(dimensions:PairwiseConfig[],rows:PairwiseRule[],exclusions:PairwiseRule[]=[]){
  const required=possiblePairs(dimensions,exclusions);const covered=new Set(rows.flatMap(row=>rowPairs(dimensions,row)).filter(pair=>required.has(pair)));const missing=[...required].filter(pair=>!covered.has(pair)).map(pair=>{const [i,a,j,b]=JSON.parse(pair) as [number,string,number,string];return `${dimensions[i].name}=${a} × ${dimensions[j].name}=${b}`})
  return{total:required.size,covered:covered.size,missing,percentage:required.size?Math.round(covered.size/required.size*100):100}
}

export function generatePairwise(dimensions:PairwiseConfig[],options:{exclusions?:PairwiseRule[];forced?:PairwiseRule[]}={}) {
  if(!dimensions.length)return []
  if(dimensions.length<2||dimensions.length>8)throw new Error('Pairwise 需要 2–8 个维度')
  if(new Set(dimensions.map(dimension=>dimension.name)).size!==dimensions.length)throw new Error('Pairwise 维度名称不能重复')
  if(dimensions.some(dimension=>!dimension.name||!dimension.values.length))throw new Error('每个 Pairwise 维度都需要名称和候选值')
  if(dimensions.some(dimension=>dimension.name.length>80||dimension.values.length>20||dimension.values.some(value=>value.length>200)))throw new Error('维度名最多 80 字符，每个维度最多 20 个候选值，单值最多 200 字符')
  const dimensionsByName=new Map(dimensions.map(dimension=>[dimension.name,dimension.values]));for(const rule of [...options.exclusions||[],...options.forced||[]])for(const [name,value] of Object.entries(rule)){if(!dimensionsByName.has(name))throw new Error(`组合规则包含未知维度：${name}`);if(!dimensionsByName.get(name)!.includes(value))throw new Error(`${name} 不包含候选值：${value}`)}
  const exclusions=options.exclusions||[],uncovered=possiblePairs(dimensions,exclusions),rows:PairwiseRule[]=[]
  const append=(candidate:PairwiseRule|null)=>{if(!candidate)return;const signature=JSON.stringify(candidate);if(rows.some(row=>JSON.stringify(row)===signature))return;rows.push(candidate);rowPairs(dimensions,candidate).forEach(pair=>uncovered.delete(pair))}
  for(const forced of options.forced||[]){const candidate=completeCombination(forced,dimensions,exclusions,uncovered);if(!candidate)throw new Error(`强制组合与排除规则冲突：${Object.entries(forced).map(([key,value])=>`${key}=${value}`).join(', ')}`);append(candidate)}
  while(uncovered.size){const [key]=uncovered;const [i,a,j,b]=JSON.parse(key) as [number,string,number,string];const candidate=completeCombination({[dimensions[i].name]:a,[dimensions[j].name]:b},dimensions,exclusions,uncovered);if(!candidate){uncovered.delete(key);continue}append(candidate)}
  if(!rows.length){const candidate=completeCombination({},dimensions,exclusions,uncovered);if(candidate)rows.push(candidate)}
  return rows
}

export const STATE_CHAINS = {
  order:['待支付','已支付','待发货','已发货','已签收'],
  payment:['创建','处理中','成功'],
  logistics:['已揽收','运输中','到达网点','派送中','已签收'],
  quest:['未领取','进行中','已完成','已领奖'],
}

export type StateErrorMode='none'|'rollback'|'skip'|'duplicate'
export interface StateEventOptions { errorMode?:StateErrorMode; minStayMinutes?:number; maxStayMinutes?:number; terminalIndex?:number }

export function generateStateEvents(type:keyof typeof STATE_CHAINS,count:number,seed:number,options:boolean|StateEventOptions=false) {
  const chain=STATE_CHAINS[type];const config:StateEventOptions=typeof options==='boolean'?{errorMode:options?'rollback':'none'}:options;const errorMode=config.errorMode||'none',minStay=Math.max(1,Math.min(10_080,Math.round(config.minStayMinutes??10))),maxStay=Math.max(minStay,Math.min(10_080,Math.round(config.maxStayMinutes??180))),terminal=Math.max(1,Math.min(chain.length-1,config.terminalIndex??chain.length-1));const random=seeded(seed),base=1755129600000-86400000
  return Array.from({length:Math.max(1,Math.min(10_000,Math.floor(count)))},(_,entity)=>{const traceId=`trace-${seed}-${entity+1}`,normal=chain.slice(0,terminal+1),states=[...normal],invalidIndexes=new Set<number>();if(errorMode!=='none'&&entity%4===0){const at=Math.min(2,states.length-1);if(errorMode==='rollback'){states.splice(at,0,states[Math.max(0,at-2)]);invalidIndexes.add(at)}else if(errorMode==='skip'&&states.length>2){states.splice(1,1);invalidIndexes.add(1)}else if(errorMode==='duplicate'){states.splice(at,0,states[Math.max(0,at-1)]);invalidIndexes.add(at)}}let time=base+entity*60000;return states.map((status,index)=>{const stayMinutes=Math.floor(minStay+random()*(maxStay-minStay+1));time+=stayMinutes*60000;return{entityId:`${type}-${entity+1}`,traceId,sequence:index+1,status,occurredAt:new Date(time).toISOString(),stayMinutes:index===0?null:stayMinutes,valid:!invalidIndexes.has(index),mutation:invalidIndexes.has(index)?errorMode:undefined}})}).flat()
}

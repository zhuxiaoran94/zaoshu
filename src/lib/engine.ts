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
export function generatePairwise(dimensions:PairwiseConfig[]) {
  if(!dimensions.length) return []
  let rows:Record<string,string>[] = dimensions[0].values.map(v=>({[dimensions[0].name]:v}))
  if(dimensions.length>1) rows=rows.flatMap(r=>dimensions[1].values.map(v=>({...r,[dimensions[1].name]:v})))
  for(let d=2;d<dimensions.length;d++) {
    const dim=dimensions[d]; const uncovered=new Set<string>()
    for(let p=0;p<d;p++) for(const a of dimensions[p].values) for(const b of dim.values) uncovered.add(`${p}:${a}|${b}`)
    rows.forEach(row=>{ let best=dim.values[0],score=-1; for(const v of dim.values){ let s=0; for(let p=0;p<d;p++) if(uncovered.has(`${p}:${row[dimensions[p].name]}|${v}`)) s++; if(s>score){score=s;best=v} } row[dim.name]=best; for(let p=0;p<d;p++) uncovered.delete(`${p}:${row[dimensions[p].name]}|${best}`) })
    while(uncovered.size) { const row:Record<string,string>={}; for(let p=0;p<d;p++) row[dimensions[p].name]=dimensions[p].values[Math.floor(Math.random()*dimensions[p].values.length)]; row[dim.name]=dim.values[Math.floor(Math.random()*dim.values.length)]; let gain=0; for(let p=0;p<d;p++) if(uncovered.delete(`${p}:${row[dimensions[p].name]}|${row[dim.name]}`)) gain++; if(gain) rows.push(row as never) }
  }
  return rows
}

export const STATE_CHAINS = {
  order:['待支付','已支付','待发货','已发货','已签收'],
  payment:['创建','处理中','成功'],
  logistics:['已揽收','运输中','到达网点','派送中','已签收'],
  quest:['未领取','进行中','已完成','已领奖'],
}

export function generateStateEvents(type:keyof typeof STATE_CHAINS,count:number,seed:number,injectError=false) {
  const chain=STATE_CHAINS[type]; const random=seeded(seed); const base=Date.now()-86400000
  return Array.from({length:count},(_,entity)=>{ const traceId=`trace-${seed}-${entity+1}`; let time=base+entity*60000; const states=[...chain]; if(injectError&&entity%4===0) states.splice(2,0,states[0]); return states.map((status,index)=>{time+=Math.floor((10+random()*180)*60000);return {entityId:`${type}-${entity+1}`,traceId,sequence:index+1,status,occurredAt:new Date(time).toISOString(),valid:!injectError||entity%4!==0||index!==2}}) }).flat()
}

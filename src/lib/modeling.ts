import type { GenerateResult, GeneratedData, ProjectSchema, QualityCheck, TableSchema } from '../types'

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
      if(field.unique||field.primaryKey) { const ok=new Set(values).size===values.length; checks.push({id:`unique-${field.id}`,label:`${table.label}.${field.label} 唯一性`,status:ok?'pass':'fail',detail:ok?'无重复值':`发现 ${values.length-new Set(values).size} 个重复值`,tableId:table.id}) }
      if(field.ref) { const parents=new Set((data[field.ref.tableId]||[]).map(r=>r[field.ref!.field])); const invalid=values.filter(v=>!parents.has(v)).length; checks.push({id:`fk-${field.id}`,label:`${table.label}.${field.label} 引用完整性`,status:invalid===0?'pass':project.mode==='exception'?'expected':'fail',detail:invalid?`${invalid} 个无效引用`:'所有引用均有效',tableId:table.id}) }
      if(field.min!==undefined||field.max!==undefined) { const invalid=values.filter(v=>typeof v==='number'&&((field.min!==undefined&&v<field.min)||(field.max!==undefined&&v>field.max))).length; checks.push({id:`range-${field.id}`,label:`${table.label}.${field.label} 范围`,status:invalid===0?'pass':project.mode==='boundary'||project.mode==='exception'?'expected':'fail',detail:invalid?`${invalid} 条数据越界`:'全部位于配置范围内',tableId:table.id}) }
    }
  }
  const abnormal=Object.values(data).flat().filter(r=>r._mock_meta).length
  if(project.mode==='exception') checks.push({id:'abnormal-rate',label:'异常注入',status:abnormal?'expected':'warning',detail:`已注入 ${abnormal} 条可追溯异常`})
  return checks
}

export function refreshGeneratedResult(project:ProjectSchema,result:GenerateResult,data:GeneratedData):GenerateResult {
  const checks=validate(project,data),all=Object.values(data).flat(),abnormal=all.filter(row=>row._mock_meta).length
  const coverage=result.report.coverage.map(item=>item.label==='约束通过率'?{...item,value:Math.round(checks.filter(check=>check.status==='pass').length/Math.max(1,checks.length)*100),detail:`${checks.filter(check=>check.status==='pass').length}/${checks.length} 项检查通过`}:item)
  return{data,report:{...result.report,totalRows:all.length,normalRows:all.length-abnormal,abnormalRows:abnormal,checks,coverage}}
}

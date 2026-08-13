import { useMemo } from 'react'
import { useAppStore } from '../store'
import { plannedProjectCounts } from '../lib/cardinality'
import { ArrowDown, ArrowUp, Copy, Plus, ShieldCheck, Trash2 } from './Icons'
import type { BusinessAssertion } from '../types'

export default function TableToolbar() {
  const { project, activeTableId, updateTable, moveTable, duplicateTable, removeTable, updateProject } = useAppStore()
  const table = project.tables.find(candidate => candidate.id === activeTableId)
  const plannedCounts = useMemo(() => plannedProjectCounts(project), [project])
  if (!table) return null
  const referenceFields = table.fields.filter(field => field.ref)
  const cardinality = table.countByReference
  const updateCardinality = (patch: Partial<NonNullable<typeof table.countByReference>>) => updateTable(table.id, { countByReference: { ...cardinality!, ...patch } })
  const assertions=table.assertions??[],updateAssertion=(id:string,patch:Partial<BusinessAssertion>)=>updateTable(table.id,{assertions:assertions.map(assertion=>assertion.id===id?{...assertion,...patch}:assertion)}),addAssertion=()=>{if(assertions.length>=20)return;const field=table.fields.find(candidate=>candidate.primaryKey)??table.fields[0];updateTable(table.id,{assertions:[...assertions,{id:`assertion_${Date.now()}_${assertions.length}`,name:'必填业务字段',expression:`${field.name} != null`,message:`${field.label}不能为空`,severity:'error'}]})}
  return <>
    <div className="table-toolbar">
      <div className="table-identity"><input aria-label="数据表显示名称" value={table.label} maxLength={80} onChange={event => updateTable(table.id, { label: event.target.value })}/><input aria-label="数据表名称" value={table.name} maxLength={80} onChange={event => updateTable(table.id, { name: event.target.value.replace(/[^A-Za-z0-9_]/g, '_') })}/></div>
      <label>{cardinality ? '预计数量' : '生成数量'}<input type="number" min="1" max="100000" disabled={!!cardinality} value={cardinality ? plannedCounts[table.id] ?? 0 : table.count} onChange={event => updateTable(table.id, { count: Math.max(1, Math.min(100000, Number(event.target.value))) })}/></label>
      <label>随机种子<input type="number" value={project.seed} onChange={event => updateProject({ seed: Number(event.target.value) })}/></label><span>{table.fields.length} 字段</span>
      <div className="table-actions"><button className="icon-button" onClick={() => moveTable(table.id, -1)} title="数据表上移" aria-label="数据表上移"><ArrowUp/></button><button className="icon-button" onClick={() => moveTable(table.id, 1)} title="数据表下移" aria-label="数据表下移"><ArrowDown/></button><button className="icon-button" onClick={() => duplicateTable(table.id)} title="复制数据表" aria-label="复制数据表"><Copy/></button><button className="icon-button danger" onClick={() => removeTable(table.id)} title="删除数据表" aria-label="删除数据表"><Trash2/></button></div>
    </div>
    {referenceFields.length > 0 && <div className="cardinality-toolbar">
      <label><input type="checkbox" checked={!!cardinality} onChange={event => updateTable(table.id, { countByReference: event.target.checked ? { fieldId: referenceFields[0].id, min: 1, max: 3 } : undefined })}/><span>按父记录生成子数据</span></label>
      {cardinality && <><label>驱动外键<select aria-label="一对多驱动外键" value={cardinality.fieldId} onChange={event => updateCardinality({ fieldId: event.target.value })}>{referenceFields.map(field => <option value={field.id} key={field.id}>{field.label} · {field.name}</option>)}</select></label><label>每个父记录<input aria-label="每个父记录最少条数" type="number" min="0" max="1000" value={cardinality.min} onChange={event => updateCardinality({ min: Math.max(0, Math.min(1000, Number(event.target.value))) })}/><i>–</i><input aria-label="每个父记录最多条数" type="number" min="0" max="1000" value={cardinality.max} onChange={event => updateCardinality({ max: Math.max(0, Math.min(1000, Number(event.target.value))) })}/><b>条</b></label><em>当前种子预计 {(plannedCounts[table.id] ?? 0).toLocaleString()} 条</em></>}
    </div>}
    <details className="assertion-toolbar" open={assertions.length>0}><summary><span><ShieldCheck/>业务断言 <b>{assertions.length}</b></span><em>用安全公式检查每一行</em></summary><div className="assertion-body"><header><p>表达式结果必须为 true；只读取当前表字段，不执行 JavaScript。</p><button className="button ghost" disabled={assertions.length>=20} onClick={event=>{event.preventDefault();addAssertion()}}><Plus/>添加断言</button></header>{assertions.length===0?<div className="assertion-empty">例如：<code>status != '成功' || paidAt != null</code></div>:assertions.map(assertion=><article key={assertion.id}><label>规则名称<input value={assertion.name} maxLength={80} onChange={event=>updateAssertion(assertion.id,{name:event.target.value})}/></label><label className="assertion-expression">必须满足<input className="mono" value={assertion.expression} maxLength={500} onChange={event=>updateAssertion(assertion.id,{expression:event.target.value})}/></label><label>失败提示<input value={assertion.message} maxLength={200} onChange={event=>updateAssertion(assertion.id,{message:event.target.value})}/></label><label>级别<select value={assertion.severity} onChange={event=>updateAssertion(assertion.id,{severity:event.target.value as BusinessAssertion['severity']})}><option value="error">失败 · 阻断质量</option><option value="warning">警告 · 允许继续</option></select></label><button className="icon-button danger" aria-label={`删除断言 ${assertion.name}`} title="删除断言" onClick={()=>updateTable(table.id,{assertions:assertions.filter(candidate=>candidate.id!==assertion.id)})}><Trash2/></button></article>)}</div></details>
  </>
}

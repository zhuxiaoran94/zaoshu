import { useMemo } from 'react'
import { useAppStore } from '../store'
import { plannedProjectCounts } from '../lib/cardinality'
import { ArrowDown, ArrowUp, Copy, Trash2 } from './Icons'

export default function TableToolbar() {
  const { project, activeTableId, updateTable, moveTable, duplicateTable, removeTable, updateProject } = useAppStore()
  const table = project.tables.find(candidate => candidate.id === activeTableId)
  const plannedCounts = useMemo(() => plannedProjectCounts(project), [project])
  if (!table) return null
  const referenceFields = table.fields.filter(field => field.ref)
  const cardinality = table.countByReference
  const updateCardinality = (patch: Partial<NonNullable<typeof table.countByReference>>) => updateTable(table.id, { countByReference: { ...cardinality!, ...patch } })
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
  </>
}

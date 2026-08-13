import type { DataRow, FieldRule, GeneratedData, ProjectSchema, RelationValueRule } from '../types'
import { compileFormula, formulaReferences, validateFormula } from './formula'

const valueKey = (value: unknown) => `${typeof value}:${JSON.stringify(value)}`
const round = (value: number, precision = 2) => Number(value.toFixed(Math.max(0, Math.min(12, precision))))

export function calculateRelationValues(project: ProjectSchema, tableId: string, field: FieldRule, rows: DataRow[], data: GeneratedData): unknown[] {
  const rule = field.relationValue
  if (!rule) return rows.map(row => row[field.name])
  if (rule.kind === 'lookup') {
    const sourceMap = new Map((data[rule.sourceTableId] ?? []).map(source => [valueKey(source[rule.sourceKey]), source[rule.sourceField]]))
    return rows.map(row => sourceMap.get(valueKey(row[rule.localForeignKey])) ?? null)
  }
  const source = project.tables.find(table => table.id === rule.sourceTableId)
  const foreignKey = source?.fields.find(candidate => candidate.name === rule.sourceForeignKey)
  const targetField = foreignKey?.ref?.field
  const evaluateExpression = rule.operation === 'count' ? null : compileFormula(rule.expression)
  const groups = new Map<string, number[]>()
  for (const sourceRow of data[rule.sourceTableId] ?? []) {
    const key = valueKey(sourceRow[rule.sourceForeignKey])
    const values = groups.get(key) ?? []
    if (rule.operation === 'count') values.push(1)
    else {
      try {
        const value = Number(evaluateExpression!(sourceRow))
        if (Number.isFinite(value)) values.push(value)
      } catch {
        // 定向注入的异常明细仍保留在结果中，由字段质量检查定位；聚合器只忽略不可计算值。
      }
    }
    groups.set(key, values)
  }
  return rows.map(row => {
    const values = (targetField ? groups.get(valueKey(row[targetField])) : undefined) ?? []
    if (rule.operation === 'count') return values.length
    if (!values.length) return 0
    const result = rule.operation === 'sum' ? values.reduce((sum, value) => sum + value, 0) : rule.operation === 'min' ? Math.min(...values) : Math.max(...values)
    return round(result, rule.precision)
  })
}

export function orderRelationValueFields(project: ProjectSchema) {
  const items = project.tables.flatMap(table => table.fields.filter(field => field.relationValue).map(field => ({ table, field })))
  const keyFor = (tableId: string, fieldName: string) => `${tableId}.${fieldName}`
  const byKey = new Map(items.map(item => [keyFor(item.table.id, item.field.name), item]))
  const visiting = new Set<string>(), visited = new Set<string>(), ordered: typeof items = []
  const visit = (item: typeof items[number]) => {
    const key = keyFor(item.table.id, item.field.name)
    if (visiting.has(key)) throw new Error(`跨表计算存在循环依赖：${item.table.label}.${item.field.label}`)
    if (visited.has(key)) return
    visiting.add(key)
    const rule = item.field.relationValue!
    let dependencies: string[] = []
    if (rule.kind === 'lookup') dependencies = [keyFor(rule.sourceTableId, rule.sourceField)]
    else if (rule.operation !== 'count') {
      try { dependencies = formulaReferences(rule.expression).map(reference => keyFor(rule.sourceTableId, reference)) } catch { /* 语法错误由生成前规则校验单独报告 */ }
    }
    for (const dependency of dependencies) { const source = byKey.get(dependency); if (source) visit(source) }
    visiting.delete(key)
    visited.add(key)
    ordered.push(item)
  }
  items.forEach(visit)
  return ordered
}

export function applyRelationValues(project: ProjectSchema, data: GeneratedData) {
  orderRelationValueFields(project).forEach(({table,field}) => {
    const rows = data[table.id] ?? [], values = calculateRelationValues(project,table.id,field,rows,data)
    rows.forEach((row,index) => { if (project.mode !== 'exception' || row._mock_meta?.field !== field.name) row[field.name] = values[index] })
  })
  return data
}

export function validateRelationValueRule(project: ProjectSchema, tableId: string, field: FieldRule): string[] {
  const rule = field.relationValue
  if (!rule) return []
  const table = project.tables.find(candidate => candidate.id === tableId)
  if (!table) return ['目标数据表不存在']
  if (rule.kind === 'lookup') {
    const source = project.tables.find(candidate => candidate.id === rule.sourceTableId)
    const local=table.fields.find(candidate=>candidate.name===rule.localForeignKey)
    return [
      !local?.ref ? '当前表外键不存在' : '',
      !source ? '来源数据表不存在' : '',
      local?.ref&&source&&(local.ref.tableId!==source.id||local.ref.field!==rule.sourceKey)?'当前外键与来源键不匹配':'',
      source && !source.fields.some(candidate => candidate.name === rule.sourceKey) ? '来源键字段不存在' : '',
      source && !source.fields.some(candidate => candidate.name === rule.sourceField) ? '来源值字段不存在' : '',
    ].filter(Boolean)
  }
  const source = project.tables.find(candidate => candidate.id === rule.sourceTableId)
  if (!source) return ['明细数据表不存在']
  const foreignKey=source.fields.find(candidate=>candidate.name===rule.sourceForeignKey),errors = [!foreignKey?.ref||foreignKey.ref.tableId!==tableId ? '明细关联字段未引用当前表' : ''].filter(Boolean)
  if (rule.operation !== 'count') {
    try { const result = validateFormula(rule.expression, source.fields.map(candidate => candidate.name));if(result.missing.length)errors.push(`表达式引用不存在字段：${[...new Set(result.missing)].join('、')}`) }
    catch (error) { errors.push(error instanceof Error ? error.message : '表达式无效') }
  }
  return errors
}

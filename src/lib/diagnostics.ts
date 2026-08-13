import type { ProjectSchema } from '../types'
import { sortTables } from './modeling'

export interface DiagnosticIssue {
  id: string
  level: 'error' | 'warning'
  title: string
  detail: string
  tableId?: string
  fieldId?: string
  suggestion: string
}

const SEQUENCE_GENERATORS = new Set(['autoId', 'sequence', 'uuid', 'ulid', 'snowflake', 'traceId', 'spanId', 'sessionId', 'orderNo', 'transactionNo'])
const LIMITED_ENUMS: Record<string, number> = {
  gender: 3, boolean: 2, memberLevel: 4, userStatus: 4, accountType: 3,
  transactionStatus: 4, orderStatus: 6, paymentMethod: 4, logisticsStatus: 5,
  gameClass: 5, equipmentQuality: 5, questStatus: 4, approvalStatus: 4,
  priority: 4, riskLevel: 3, currency: 5,
}

export function diagnoseProject(project: ProjectSchema): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []
  const tableIds = new Set(project.tables.map(table => table.id))
  const tableNames = new Map<string, number>()
  const totalRows = project.tables.reduce((sum, table) => sum + table.count, 0)
  if (totalRows > 200_000) issues.push({ id: 'project-total', level: 'error', title: '项目数据量过大', detail: `当前计划生成 ${totalRows.toLocaleString()} 条，公开版上限为 200,000 条。`, suggestion: '减少单表生成数量，或拆成多个项目分批生成。' })
  if (totalRows > 100_000) issues.push({ id: 'project-large', level: 'warning', title: '本次生成量较大', detail: `将生成 ${totalRows.toLocaleString()} 条数据，可能占用较多浏览器内存。`, suggestion: '优先按表分批导出，并关闭其他占用内存的页面。' })

  project.tables.forEach(table => {
    tableNames.set(table.name, (tableNames.get(table.name) || 0) + 1)
    const fieldNames = new Map<string, number>()
    table.fields.forEach(field => fieldNames.set(field.name, (fieldNames.get(field.name) || 0) + 1))
    fieldNames.forEach((count, name) => {
      if (count > 1) issues.push({ id: `duplicate-field-${table.id}-${name}`, level: 'error', title: '字段名重复', detail: `${table.label} 中存在 ${count} 个名为 ${name} 的字段。`, tableId: table.id, suggestion: '为同一数据表中的每个字段设置不同的字段名。' })
    })
    table.fields.forEach(field => {
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) issues.push({ id: `range-${field.id}`, level: 'error', title: '数值范围冲突', detail: `${table.label}.${field.label} 的最小值 ${field.min} 大于最大值 ${field.max}。`, tableId: table.id, fieldId: field.id, suggestion: '调整最小值或最大值，使最小值不大于最大值。' })
      if (field.ref) {
        const target = project.tables.find(candidate => candidate.id === field.ref!.tableId)
        if (!target) issues.push({ id: `ref-table-${field.id}`, level: 'error', title: '引用的数据表不存在', detail: `${table.label}.${field.label} 引用了已删除的数据表。`, tableId: table.id, fieldId: field.id, suggestion: '清除该引用，或重新选择目标数据表和字段。' })
        else if (!target.fields.some(candidate => candidate.name === field.ref!.field)) issues.push({ id: `ref-field-${field.id}`, level: 'error', title: '引用的字段不存在', detail: `${table.label}.${field.label} 引用了 ${target.label}.${field.ref.field}，但目标字段不存在。`, tableId: table.id, fieldId: field.id, suggestion: '重新选择目标表中的主键或唯一字段。' })
      }
      if (field.unique && !SEQUENCE_GENERATORS.has(field.generator)) {
        const capacity = field.values?.length || LIMITED_ENUMS[field.generator]
        if (capacity !== undefined && table.count > capacity) issues.push({ id: `unique-${field.id}`, level: 'error', title: '唯一值空间不足', detail: `${table.label}.${field.label} 只有 ${capacity} 个候选值，却需要生成 ${table.count} 条唯一数据。`, tableId: table.id, fieldId: field.id, suggestion: '关闭唯一约束、增加候选值，或减少生成数量。' })
      }
      if (field.formula) {
        const expression = field.formula.replace(/"[^"]*"|'[^']*'/g, '')
        const identifiers = [...expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(match => match[0]).filter(identifier => !['round', 'min', 'max', 'length', 'true', 'false'].includes(identifier))
        const missing = identifiers.filter(identifier => !table.fields.some(candidate => candidate.name === identifier))
        if (missing.length) issues.push({ id: `formula-${field.id}`, level: 'error', title: '公式引用不存在字段', detail: `${table.label}.${field.label} 的公式引用了 ${[...new Set(missing)].join('、')}。`, tableId: table.id, fieldId: field.id, suggestion: '修正公式字段名，或先创建被引用字段。' })
      }
      if ((field.nullable || 0) + (field.missing || 0) > 100) issues.push({ id: `empty-rate-${field.id}`, level: 'warning', title: '空值比例可能超出预期', detail: `${table.label}.${field.label} 的空值率与缺失率之和超过 100%。`, tableId: table.id, fieldId: field.id, suggestion: '降低空值率或字段缺失率。' })
      field.condition?.rules.forEach((rule, index) => {
        if (rule.field === field.name) issues.push({ id: `condition-self-${field.id}-${index}`, level: 'error', title: '条件不能引用字段自身', detail: `${table.label}.${field.label} 的第 ${index + 1} 条条件引用了自身。`, tableId: table.id, fieldId: field.id, suggestion: '选择当前表中的另一个字段作为条件来源。' })
        else if (!table.fields.some(candidate => candidate.name === rule.field)) issues.push({ id: `condition-field-${field.id}-${index}`, level: 'error', title: '条件引用不存在字段', detail: `${table.label}.${field.label} 的条件引用了 ${rule.field}，但该字段不存在。`, tableId: table.id, fieldId: field.id, suggestion: '重新选择条件来源字段，或移除这条规则。' })
        if (!['empty', 'notEmpty'].includes(rule.operator) && !rule.value?.trim()) issues.push({ id: `condition-value-${field.id}-${index}`, level: 'warning', title: '条件比较值为空', detail: `${table.label}.${field.label} 的第 ${index + 1} 条条件没有比较值。`, tableId: table.id, fieldId: field.id, suggestion: '填写比较值；判断空值请改用“为空”或“不为空”。' })
      })
    })
  })
  tableNames.forEach((count, name) => {
    if (count > 1) issues.push({ id: `duplicate-table-${name}`, level: 'error', title: '数据表名称重复', detail: `存在 ${count} 张名为 ${name} 的数据表，SQL 导出会发生冲突。`, suggestion: '为每张数据表设置不同的英文名称。' })
  })
  try { sortTables(project.tables) } catch (error) { issues.push({ id: 'dependency-cycle', level: 'error', title: '存在循环依赖', detail: error instanceof Error ? error.message : '数据表之间形成循环引用。', suggestion: '移除其中一条外键引用，确保依赖关系可以排序。' }) }
  if (!tableIds.size) issues.push({ id: 'no-table', level: 'error', title: '项目没有数据表', detail: '至少需要一张数据表才能生成数据。', suggestion: '新增数据表或选择一个内置模板。' })
  return issues
}

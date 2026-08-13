import type { ProjectSchema } from '../types'
import { sortTables } from './modeling'
import { ENUM_SIZES } from '../data/generatorCatalog'
import { orderFormulaFields, validateFormula } from './formula'
import { plannedProjectCounts, plannedProjectTotal } from './cardinality'
import { orderRelationValueFields, validateRelationValueRule } from './relationValues'

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
  const plannedCounts = plannedProjectCounts(project),totalRows = plannedProjectTotal(project),maximumRows=plannedProjectTotal(project,true)
  if (totalRows > 200_000) issues.push({ id: 'project-total', level: 'error', title: '项目数据量过大', detail: `当前计划生成 ${totalRows.toLocaleString()} 条，公开版上限为 200,000 条。`, suggestion: '减少单表生成数量，或拆成多个项目分批生成。' })
  if (totalRows > 100_000) issues.push({ id: 'project-large', level: 'warning', title: '本次生成量较大', detail: `将生成 ${totalRows.toLocaleString()} 条数据，可能占用较多浏览器内存。`, suggestion: '优先按表分批导出，并关闭其他占用内存的页面。' })
  if(maximumRows>200_000&&totalRows<=200_000)issues.push({id:'project-cardinality-maximum',level:'warning',title:'一对多上限较大',detail:`预计 ${totalRows.toLocaleString()} 条，最大可达 ${maximumRows.toLocaleString()} 条。`,suggestion:'降低每个父记录的最多条数。'})

  project.tables.forEach(table => {
    const plannedCount=plannedCounts[table.id]??table.count
    if(plannedCount>100_000)issues.push({id:`table-total-${table.id}`,level:'error',title:'单表数据量过大',detail:`${table.label} 预计 ${plannedCount.toLocaleString()} 条，上限 100,000 条。`,tableId:table.id,suggestion:'降低父表数量或子记录范围。'})
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
        else if ((field.ref.strategy === 'oneToOne' || field.unique || field.primaryKey) && plannedCount > (plannedCounts[target.id]??target.count)) issues.push({ id: `ref-capacity-${field.id}`, level: 'error', title: '唯一引用容量不足', detail: `${table.label}.${field.label} 需要 ${plannedCount} 个唯一引用，但 ${target.label} 只有 ${plannedCounts[target.id]??target.count} 条。`, tableId: table.id, fieldId: field.id, suggestion: `减少当前表数量或一对多基数，增加父表数量，或关闭唯一引用。` })
        if (field.ref.strategy === 'oneToOne' && ((field.nullable ?? 0) > 0 || (field.missing ?? 0) > 0)) issues.push({ id: `ref-one-null-${field.id}`, level: 'error', title: '一对一引用不能随机留空', detail: `${table.label}.${field.label} 配置了严格一对一，同时设置了空值率或缺失率。`, tableId: table.id, fieldId: field.id, suggestion: '将空值率和缺失率设为 0，或改用非严格分配策略。' })
        if (field.ref.strategy === 'oneToOne' && field.condition) issues.push({ id: `ref-one-condition-${field.id}`, level: 'error', title: '一对一引用不能使用条件生成', detail: `${table.label}.${field.label} 的条件规则可能把唯一引用置空或移除。`, tableId: table.id, fieldId: field.id, suggestion: '移除条件规则，或改用非严格分配策略。' })
        if (field.prefix || field.suffix || field.formula) issues.push({ id: `ref-transform-${field.id}`, level: 'error', title: '外键不能再做值变换', detail: `${table.label}.${field.label} 同时配置了外键与前后缀或计算公式，生成值将不再匹配父表。`, tableId: table.id, fieldId: field.id, suggestion: '保留外键引用，清除该字段的前缀、后缀和计算公式。' })
      }
      if (field.unique && !SEQUENCE_GENERATORS.has(field.generator)) {
        const capacity = field.values?.length || LIMITED_ENUMS[field.generator]
        if (capacity !== undefined && plannedCount > capacity) issues.push({ id: `unique-${field.id}`, level: 'error', title: '唯一值空间不足', detail: `${table.label}.${field.label} 只有 ${capacity} 个候选值，却需要生成 ${plannedCount} 条唯一数据。`, tableId: table.id, fieldId: field.id, suggestion: '关闭唯一约束、增加候选值，或减少生成数量。' })
      }
      if (field.formula) {try{const{missing}=validateFormula(field.formula,table.fields.filter(candidate=>candidate.id!==field.id).map(candidate=>candidate.name));if(missing.length)issues.push({ id: `formula-${field.id}`, level: 'error', title: '公式引用不存在字段', detail: `${table.label}.${field.label} 的公式引用了 ${[...new Set(missing)].join('、')}。`, tableId: table.id, fieldId: field.id, suggestion: '修正公式字段名，或先创建被引用字段。' })}catch(error){issues.push({id:`formula-syntax-${field.id}`,level:'error',title:'计算公式语法错误',detail:`${table.label}.${field.label}：${error instanceof Error?error.message:'无法解析公式'}`,tableId:table.id,fieldId:field.id,suggestion:'使用白名单运算符和函数，检查括号、引号及参数。'})}}
      if ((field.nullable || 0) + (field.missing || 0) > 100) issues.push({ id: `empty-rate-${field.id}`, level: 'warning', title: '空值比例可能超出预期', detail: `${table.label}.${field.label} 的空值率与缺失率之和超过 100%。`, tableId: table.id, fieldId: field.id, suggestion: '降低空值率或字段缺失率。' })
      if(field.weights){const expected=field.values?.length||ENUM_SIZES[field.generator];if(expected!==undefined&&field.weights.length!==expected)issues.push({id:`weights-length-${field.id}`,level:'error',title:'枚举权重数量不匹配',detail:`${table.label}.${field.label} 有 ${expected} 个候选值，但配置了 ${field.weights.length} 个权重。`,tableId:table.id,fieldId:field.id,suggestion:'为每个候选值配置一个对应权重。'});if(!field.weights.some(weight=>weight>0))issues.push({id:`weights-zero-${field.id}`,level:'error',title:'权重不能全部为零',detail:`${table.label}.${field.label} 的所有候选项权重均为 0。`,tableId:table.id,fieldId:field.id,suggestion:'至少将一个候选项权重设置为大于 0。'})}
      if(field.distributionCenter!==undefined&&field.dataType==='number'&&((field.min!==undefined&&field.distributionCenter<field.min)||(field.max!==undefined&&field.distributionCenter>field.max)))issues.push({id:`distribution-center-${field.id}`,level:'warning',title:'分布中心超出数值范围',detail:`${table.label}.${field.label} 的分布中心 ${field.distributionCenter} 不在配置范围内。`,tableId:table.id,fieldId:field.id,suggestion:'将分布中心调整到最小值和最大值之间。'})
      validateRelationValueRule(project,table.id,field).forEach((detail,index)=>issues.push({id:`relation-value-${field.id}-${index}`,level:'error',title:'跨表计算规则无效',detail:`${table.label}.${field.label}：${detail}`,tableId:table.id,fieldId:field.id,suggestion:'重新选择关联表和字段，或修正安全表达式。'}))
      if(field.relationValue&&field.formula)issues.push({id:`relation-formula-${field.id}`,level:'error',title:'字段存在两个计算来源',detail:`${table.label}.${field.label} 同时配置了行内公式和跨表计算。`,tableId:table.id,fieldId:field.id,suggestion:'只保留一种计算规则。'})
      field.condition?.rules.forEach((rule, index) => {
        if (rule.field === field.name) issues.push({ id: `condition-self-${field.id}-${index}`, level: 'error', title: '条件不能引用字段自身', detail: `${table.label}.${field.label} 的第 ${index + 1} 条条件引用了自身。`, tableId: table.id, fieldId: field.id, suggestion: '选择当前表中的另一个字段作为条件来源。' })
        else if (!table.fields.some(candidate => candidate.name === rule.field)) issues.push({ id: `condition-field-${field.id}-${index}`, level: 'error', title: '条件引用不存在字段', detail: `${table.label}.${field.label} 的条件引用了 ${rule.field}，但该字段不存在。`, tableId: table.id, fieldId: field.id, suggestion: '重新选择条件来源字段，或移除这条规则。' })
        if (!['empty', 'notEmpty'].includes(rule.operator) && !rule.value?.trim()) issues.push({ id: `condition-value-${field.id}-${index}`, level: 'warning', title: '条件比较值为空', detail: `${table.label}.${field.label} 的第 ${index + 1} 条条件没有比较值。`, tableId: table.id, fieldId: field.id, suggestion: '填写比较值；判断空值请改用“为空”或“不为空”。' })
      })
    })
    if(table.countByReference){const config=table.countByReference,driver=table.fields.find(field=>field.id===config.fieldId);if(!driver?.ref)issues.push({id:`cardinality-field-${table.id}`,level:'error',title:'一对多驱动字段无效',detail:`${table.label} 的驱动字段不是外键。`,tableId:table.id,suggestion:'重新选择外键或改回固定条数。'});else{if(config.min>config.max)issues.push({id:`cardinality-range-${table.id}`,level:'error',title:'一对多数量范围无效',detail:`${table.label} 最少 ${config.min} 条大于最多 ${config.max} 条。`,tableId:table.id,fieldId:driver.id,suggestion:'调小最少条数。'});if(config.max>1&&(driver.unique||driver.primaryKey||driver.ref.strategy==='oneToOne'))issues.push({id:`cardinality-unique-${table.id}`,level:'error',title:'一对多与唯一引用冲突',detail:`${table.label}.${driver.label} 最多 ${config.max} 条，不能要求引用唯一。`,tableId:table.id,fieldId:driver.id,suggestion:'关闭唯一约束，或将最多条数设为 1。'});if((driver.nullable??0)>0||(driver.missing??0)>0||driver.condition)issues.push({id:`cardinality-empty-${table.id}`,level:'error',title:'驱动外键不能留空',detail:`${table.label}.${driver.label} 不能配置空值、缺失或条件。`,tableId:table.id,fieldId:driver.id,suggestion:'清除空值、缺失和条件规则。'})}}
    try{orderFormulaFields(table.fields)}catch(error){issues.push({id:`formula-cycle-${table.id}`,level:'error',title:'计算字段循环依赖',detail:`${table.label}：${error instanceof Error?error.message:'计算字段无法排序'}`,tableId:table.id,suggestion:'移除其中一条计算字段引用，使依赖形成单向链。'})}
    const assertionIds=new Set<string>();for(const assertion of table.assertions??[]){if(assertionIds.has(assertion.id))issues.push({id:`assertion-duplicate-${table.id}-${assertion.id}`,level:'error',title:'业务断言 ID 重复',detail:`${table.label} 中存在重复的断言 ID ${assertion.id}。`,tableId:table.id,suggestion:'删除重复规则后重新添加。'});assertionIds.add(assertion.id);try{const{missing}=validateFormula(assertion.expression,table.fields.map(field=>field.name));if(missing.length)issues.push({id:`assertion-fields-${table.id}-${assertion.id}`,level:'error',title:'业务断言引用不存在字段',detail:`${table.label}.${assertion.name} 引用了 ${[...new Set(missing)].join('、')}。`,tableId:table.id,fieldId:table.fields.find(field=>field.name===missing[0])?.id,suggestion:'修正规则中的字段名，或先创建对应字段。'})}catch(error){issues.push({id:`assertion-syntax-${table.id}-${assertion.id}`,level:'error',title:'业务断言语法错误',detail:`${table.label}.${assertion.name}：${error instanceof Error?error.message:'无法解析规则'}`,tableId:table.id,suggestion:'使用白名单运算符和函数，检查括号、引号及参数。'})}}
  })
  tableNames.forEach((count, name) => {
    if (count > 1) issues.push({ id: `duplicate-table-${name}`, level: 'error', title: '数据表名称重复', detail: `存在 ${count} 张名为 ${name} 的数据表，SQL 导出会发生冲突。`, suggestion: '为每张数据表设置不同的英文名称。' })
  })
  try { sortTables(project.tables) } catch (error) { issues.push({ id: 'dependency-cycle', level: 'error', title: '存在循环依赖', detail: error instanceof Error ? error.message : '数据表之间形成循环引用。', suggestion: '移除其中一条外键引用，确保依赖关系可以排序。' }) }
  try{orderRelationValueFields(project)}catch(error){issues.push({id:'relation-value-cycle',level:'error',title:'跨表计算循环依赖',detail:error instanceof Error?error.message:'跨表计算规则相互引用。',suggestion:'移除其中一条跨表计算规则，使计算方向保持单向。'})}
  if (!tableIds.size) issues.push({ id: 'no-table', level: 'error', title: '项目没有数据表', detail: '至少需要一张数据表才能生成数据。', suggestion: '新增数据表或选择一个内置模板。' })
  return issues
}

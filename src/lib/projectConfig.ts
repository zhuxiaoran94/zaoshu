import { z } from 'zod'
import type { ProjectSchema } from '../types'
import { plannedProjectTotal } from './cardinality'

const MAX_TABLES = 50
const MAX_FIELDS_PER_TABLE = 200
const MAX_TOTAL_ROWS = 200_000
export const MAX_CONFIG_BYTES = 1024 * 1024

const refSchema = z.object({
  tableId: z.string().min(1).max(80),
  field: z.string().min(1).max(80),
  strategy: z.enum(['random', 'roundRobin', 'hotspot', 'oneToOne']).optional(),
  hotspotPercent: z.number().int().min(1).max(50).optional(),
})

const conditionSchema = z.object({
  combinator: z.enum(['and', 'or']),
  rules: z.array(z.object({
    field: z.string().min(1).max(80),
    operator: z.enum(['equals', 'notEquals', 'contains', 'greaterThan', 'lessThan', 'empty', 'notEmpty']),
    value: z.string().max(2_000).optional(),
  })).min(1).max(10),
  otherwise: z.enum(['null', 'omit']),
})

const relationValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind:z.literal('aggregate'),sourceTableId:z.string().min(1).max(80),sourceForeignKey:z.string().min(1).max(80),expression:z.string().min(1).max(500),operation:z.enum(['sum','count','min','max']),precision:z.number().int().min(0).max(12).optional() }),
  z.object({ kind:z.literal('lookup'),localForeignKey:z.string().min(1).max(80),sourceTableId:z.string().min(1).max(80),sourceKey:z.string().min(1).max(80),sourceField:z.string().min(1).max(80) }),
])

const fieldSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '字段名只能使用字母、数字和下划线'),
  label: z.string().min(1).max(80),
  generator: z.string().min(1).max(80),
  dataType: z.enum(['string', 'number', 'boolean', 'date', 'object']),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  precision: z.number().int().min(0).max(12).optional(),
  length: z.number().int().min(0).max(10_000).optional(),
  values: z.array(z.string().max(2_000)).max(10_000).optional(),
  weights: z.array(z.number().finite().nonnegative()).max(10_000).optional(),
  prefix: z.string().max(200).optional(),
  suffix: z.string().max(200).optional(),
  fixedValue: z.string().max(10_000).optional(),
  nullable: z.number().min(0).max(100).optional(),
  missing: z.number().min(0).max(100).optional(),
  abnormal: z.number().min(0).max(100).optional(),
  unique: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  ref: refSchema.optional(),
  relationValue: relationValueSchema.optional(),
  formula: z.string().max(500).optional(),
  format: z.string().max(500).optional(),
  condition: conditionSchema.optional(),
  distribution: z.enum(['uniform', 'normal', 'longTail', 'hotspot', 'ascending', 'descending']).optional(),
  distributionCenter: z.number().finite().optional(),
})

const assertionSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  expression: z.string().min(1).max(500),
  message: z.string().min(1).max(200),
  severity: z.enum(['error', 'warning']),
})

const tableSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '表名只能使用字母、数字和下划线'),
  label: z.string().min(1).max(80),
  count: z.number().int().min(1).max(100_000),
  countByReference: z.object({
    fieldId: z.string().min(1).max(100),
    min: z.number().int().min(0).max(1_000),
    max: z.number().int().min(0).max(1_000),
  }).optional(),
  assertions: z.array(assertionSchema).max(20).optional(),
  fields: z.array(fieldSchema).min(1).max(MAX_FIELDS_PER_TABLE),
})

const projectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  templateId: z.string().max(80),
  description: z.string().max(500),
  seed: z.number().int().min(0).max(2_147_483_647),
  referenceDate: z.string().datetime({ offset: true }).optional(),
  mode: z.enum(['random', 'realistic', 'boundary', 'exception', 'pairwise']),
  version: z.string().min(1).max(20),
  tables: z.array(tableSchema).min(1).max(MAX_TABLES),
}).superRefine((project, context) => {
  const totalRows = plannedProjectTotal(project)
  if (totalRows > MAX_TOTAL_ROWS) context.addIssue({ code: z.ZodIssueCode.custom, message: `总生成量不能超过 ${MAX_TOTAL_ROWS.toLocaleString()} 条`, path: ['tables'] })
  const tableIds = new Set(project.tables.map(table => table.id))
  if (tableIds.size !== project.tables.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '数据表 ID 不能重复', path: ['tables'] })
  project.tables.forEach((table, tableIndex) => {
    const names = new Set(table.fields.map(field => field.name))
    if (names.size !== table.fields.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '同一数据表中的字段名不能重复', path: ['tables', tableIndex, 'fields'] })
    if (table.countByReference) {
      const countField = table.fields.find(field => field.id === table.countByReference!.fieldId)
      if (!countField?.ref) context.addIssue({ code: z.ZodIssueCode.custom, message: '按父记录生成必须选择当前表中的外键字段', path: ['tables', tableIndex, 'countByReference', 'fieldId'] })
      if (table.countByReference.min > table.countByReference.max) context.addIssue({ code: z.ZodIssueCode.custom, message: '每个父记录最少条数不能大于最多条数', path: ['tables', tableIndex, 'countByReference'] })
    }
    table.fields.forEach((field, fieldIndex) => {
      if (field.ref && !tableIds.has(field.ref.tableId)) context.addIssue({ code: z.ZodIssueCode.custom, message: `引用的数据表 ${field.ref.tableId} 不存在`, path: ['tables', tableIndex, 'fields', fieldIndex, 'ref'] })
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) context.addIssue({ code: z.ZodIssueCode.custom, message: '最小值不能大于最大值', path: ['tables', tableIndex, 'fields', fieldIndex] })
    })
  })
})

interface ProjectFile {
  fileType: 'mock-data-project'
  fileVersion: 1
  exportedAt: string
  project: ProjectSchema
}

export function serializeProject(project: ProjectSchema) {
  const payload: ProjectFile = { fileType: 'mock-data-project', fileVersion: 1, exportedAt: new Date().toISOString(), project }
  return JSON.stringify(payload, null, 2)
}

export function parseProjectFile(raw: string): ProjectSchema {
  if (new Blob([raw]).size > MAX_CONFIG_BYTES) throw new Error('配置文件不能超过 1 MB')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('不是有效的 JSON 配置文件') }
  if (!parsed || typeof parsed !== 'object') throw new Error('配置文件结构无效')
  const candidate = parsed as Partial<ProjectFile>
  if (candidate.fileType !== 'mock-data-project' || candidate.fileVersion !== 1) throw new Error('不是 Mock造数工具支持的项目文件')
  const result = projectSchema.safeParse(candidate.project)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(`${first.path.join('.') || 'project'}：${first.message}`)
  }
  return result.data
}

export function safeProjectFilename(name: string) {
  return `${name.replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '_').slice(0, 80) || 'mock-project'}.mock.json`
}

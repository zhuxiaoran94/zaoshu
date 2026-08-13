import { z } from 'zod'
import type { ProjectSchema } from '../types'

const MAX_TABLES = 50
const MAX_FIELDS_PER_TABLE = 200
const MAX_TOTAL_ROWS = 200_000
export const MAX_CONFIG_BYTES = 1024 * 1024

const refSchema = z.object({
  tableId: z.string().min(1).max(80),
  field: z.string().min(1).max(80),
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
  formula: z.string().max(500).optional(),
  format: z.string().max(500).optional(),
  condition: conditionSchema.optional(),
})

const tableSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '表名只能使用字母、数字和下划线'),
  label: z.string().min(1).max(80),
  count: z.number().int().min(1).max(100_000),
  fields: z.array(fieldSchema).min(1).max(MAX_FIELDS_PER_TABLE),
})

const projectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  templateId: z.string().max(80),
  description: z.string().max(500),
  seed: z.number().int().min(0).max(2_147_483_647),
  mode: z.enum(['random', 'realistic', 'boundary', 'exception', 'pairwise']),
  version: z.string().min(1).max(20),
  tables: z.array(tableSchema).min(1).max(MAX_TABLES),
}).superRefine((project, context) => {
  const totalRows = project.tables.reduce((sum, table) => sum + table.count, 0)
  if (totalRows > MAX_TOTAL_ROWS) context.addIssue({ code: z.ZodIssueCode.custom, message: `总生成量不能超过 ${MAX_TOTAL_ROWS.toLocaleString()} 条`, path: ['tables'] })
  const tableIds = new Set(project.tables.map(table => table.id))
  if (tableIds.size !== project.tables.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '数据表 ID 不能重复', path: ['tables'] })
  project.tables.forEach((table, tableIndex) => {
    const names = new Set(table.fields.map(field => field.name))
    if (names.size !== table.fields.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '同一数据表中的字段名不能重复', path: ['tables', tableIndex, 'fields'] })
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

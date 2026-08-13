export type DataMode = 'random' | 'realistic' | 'boundary' | 'exception' | 'pairwise'
export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'object'

export interface GeneratorDefinition {
  key: string
  name: string
  category: string
  dataType: DataType
  sample?: string
}

export type ConditionOperator = 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'empty' | 'notEmpty'

export interface FieldCondition {
  combinator: 'and' | 'or'
  rules: Array<{ field: string; operator: ConditionOperator; value?: string }>
  otherwise: 'null' | 'omit'
}

export type DistributionType = 'uniform' | 'normal' | 'longTail' | 'hotspot' | 'ascending' | 'descending'
export type ReferenceStrategy = 'random' | 'roundRobin' | 'hotspot' | 'oneToOne'

export interface FieldReference {
  tableId: string
  field: string
  strategy?: ReferenceStrategy
  hotspotPercent?: number
}

export interface FieldRule {
  id: string
  name: string
  label: string
  generator: string
  dataType: DataType
  min?: number
  max?: number
  precision?: number
  length?: number
  values?: string[]
  weights?: number[]
  prefix?: string
  suffix?: string
  fixedValue?: string
  nullable?: number
  missing?: number
  abnormal?: number
  unique?: boolean
  primaryKey?: boolean
  ref?: FieldReference
  formula?: string
  format?: string
  condition?: FieldCondition
  distribution?: DistributionType
  distributionCenter?: number
}

export interface TableSchema {
  id: string
  name: string
  label: string
  count: number
  fields: FieldRule[]
}

export interface ProjectSchema {
  id: string
  name: string
  templateId: string
  description: string
  seed: number
  mode: DataMode
  version: string
  tables: TableSchema[]
}

export interface MockMeta {
  field: string
  rule: string
  mutation: string
  expected: string
}

export type DataRow = Record<string, unknown> & { _mock_meta?: MockMeta }
export type GeneratedData = Record<string, DataRow[]>

export interface QualityCheck {
  id: string
  label: string
  status: 'pass' | 'warning' | 'expected' | 'fail'
  detail: string
  tableId?: string
  fieldId?: string
  rowIndexes?: number[]
  issueCount?: number
}

export type CoverageGapKind = 'enum' | 'null' | 'missing' | 'boundary'

export interface CoverageGap {
  id: string
  kind: CoverageGapKind
  tableId: string
  fieldId: string
  label: string
  detail: string
  missingValues: unknown[]
}

export interface GenerationReport {
  duration: number
  totalRows: number
  normalRows: number
  abnormalRows: number
  checks: QualityCheck[]
  coverage: Array<{ label: string; value: number; detail: string }>
  gaps: CoverageGap[]
  generatedAt: string
}

export interface GenerateResult {
  data: GeneratedData
  report: GenerationReport
}

export interface DataPool {
  id: string
  name: string
  values: string[]
  createdAt: string
}

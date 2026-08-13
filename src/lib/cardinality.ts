import type { GeneratedData, ProjectSchema, TableSchema } from '../types'

const stableHash = (value: string) => {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function childrenForParent(seed: number, tableId: string, parentIndex: number, min: number, max: number) {
  const low = Math.max(0, Math.floor(min))
  const high = Math.max(low, Math.floor(max))
  const mixed = stableHash(`${seed}:${tableId}:${parentIndex}`)
  return low + mixed % (high - low + 1)
}

export interface TableCardinalityPlan {
  count: number
  referenceFieldId?: string
  parentRowIndexes: number[]
}

const COUNT_LIMIT = 200_001

export function planTableCardinality(table: TableSchema, data: GeneratedData, seed: number): TableCardinalityPlan {
  const config = table.countByReference
  const field = config ? table.fields.find(candidate => candidate.id === config.fieldId && candidate.ref) : undefined
  if (!config || !field?.ref) return { count: table.count, parentRowIndexes: [] }
  const parents = data[field.ref.tableId] ?? []
  const parentRowIndexes = parents.flatMap((_, parentIndex) => Array(childrenForParent(seed, table.id, parentIndex, config.min, config.max)).fill(parentIndex) as number[])
  return { count: parentRowIndexes.length, referenceFieldId: field.id, parentRowIndexes }
}

export function plannedProjectCounts(project: ProjectSchema, useMaximum = false) {
  const byId = new Map(project.tables.map(table => [table.id, table]))
  const counts: Record<string, number> = {}
  const visiting = new Set<string>()
  const resolve = (table: TableSchema): number => {
    if (counts[table.id] !== undefined) return counts[table.id]
    if (visiting.has(table.id)) return table.count
    visiting.add(table.id)
    const config = table.countByReference
    const field = config ? table.fields.find(candidate => candidate.id === config.fieldId && candidate.ref) : undefined
    const parent = field?.ref ? byId.get(field.ref.tableId) : undefined
    let count = table.count
    if (config && parent) {
      const parentCount = resolve(parent)
      if (useMaximum) count = Math.min(COUNT_LIMIT, parentCount * Math.max(config.min, config.max))
      else {
        count = 0
        for (let index = 0; index < parentCount && count < COUNT_LIMIT; index++) count += childrenForParent(project.seed, table.id, index, config.min, config.max)
        count = Math.min(COUNT_LIMIT, count)
      }
    }
    visiting.delete(table.id)
    counts[table.id] = count
    return count
  }
  project.tables.forEach(resolve)
  return counts
}

export function plannedProjectTotal(project: ProjectSchema, useMaximum = false) {
  return Math.min(COUNT_LIMIT, Object.values(plannedProjectCounts(project, useMaximum)).reduce((sum, count) => sum + count, 0))
}

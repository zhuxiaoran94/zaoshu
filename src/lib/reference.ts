import type { DataRow, FieldReference } from '../types'

export const REFERENCE_STRATEGY_LABELS = {
  random: '种子随机',
  roundRobin: '轮询均匀',
  hotspot: '热点 80/20',
  oneToOne: '严格一对一',
} as const

export function referenceStrategy(ref: FieldReference) {
  return ref.strategy ?? 'random'
}

export function selectReferenceRow(ref: FieldReference, rowIndex: number, parents: DataRow[], random: () => number): DataRow | undefined {
  if (!parents.length) return undefined
  const strategy = referenceStrategy(ref)
  if (strategy === 'roundRobin') return parents[rowIndex % parents.length]
  if (strategy === 'oneToOne') return parents[rowIndex]
  if (strategy === 'hotspot') {
    const hotspotPercent = Math.min(50, Math.max(1, ref.hotspotPercent ?? 20))
    const hotSize = Math.max(1, Math.ceil(parents.length * hotspotPercent / 100))
    const useHotPool = random() < 0.8 || hotSize === parents.length
    const start = useHotPool ? 0 : hotSize
    const size = useHotPool ? hotSize : parents.length - hotSize
    return parents[start + Math.floor(random() * Math.max(1, size))]
  }
  return parents[Math.floor(random() * parents.length)]
}

export function selectReferenceValue(ref: FieldReference, rowIndex: number, parents: DataRow[], random: () => number) {
  return selectReferenceRow(ref, rowIndex, parents, random)?.[ref.field] ?? null
}

export interface ReferenceDistribution {
  assigned: number
  distinct: number
  unused: number
  minimum: number
  maximum: number
  topShare: number
  duplicateRows: number[]
}

const valueKey = (value: unknown) => `${typeof value}:${JSON.stringify(value)}`

export function analyzeReferenceDistribution(rows: DataRow[], fieldName: string, parents: DataRow[], parentField: string): ReferenceDistribution {
  const parentKeys = [...new Set(parents.map(row => row[parentField]).filter(value => value !== undefined && value !== null).map(valueKey))]
  const usage = new Map(parentKeys.map(key => [key, 0]))
  const seen = new Set<string>()
  const duplicateRows: number[] = []
  let assigned = 0
  rows.forEach((row, index) => {
    const value = row[fieldName]
    if (value === undefined || value === null) return
    assigned += 1
    const key = valueKey(value)
    if (usage.has(key)) usage.set(key, usage.get(key)! + 1)
    if (seen.has(key)) duplicateRows.push(index)
    seen.add(key)
  })
  const counts = [...usage.values()]
  const maximum = counts.length ? Math.max(...counts) : 0
  return {
    assigned,
    distinct: counts.filter(count => count > 0).length,
    unused: counts.filter(count => count === 0).length,
    minimum: counts.length ? Math.min(...counts) : 0,
    maximum,
    topShare: assigned ? Math.round(maximum / assigned * 100) : 0,
    duplicateRows,
  }
}

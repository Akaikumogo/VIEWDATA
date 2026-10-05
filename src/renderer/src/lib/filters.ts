import type { FilterOp, RowFilter } from '@shared/types'

const OPS: FilterOp[] = ['eq', 'neq', 'contains', 'gt', 'lt', 'null', 'notnull']

export function needsValue(op: FilterOp): boolean {
  return op !== 'null' && op !== 'notnull'
}

/** Filters live in the URL as repeated `f=field~op~value` params so views are shareable and survive reloads */
export function encodeFilter(f: RowFilter): string {
  return `${f.field}~${f.op}${needsValue(f.op) ? `~${f.value ?? ''}` : ''}`
}

export function decodeFilter(s: string): RowFilter | null {
  const a = s.indexOf('~')
  if (a < 0) return null
  const field = s.slice(0, a)
  const rest = s.slice(a + 1)
  const b = rest.indexOf('~')
  const op = (b < 0 ? rest : rest.slice(0, b)) as FilterOp
  if (!field || !OPS.includes(op)) return null
  return needsValue(op) ? { field, op, value: b < 0 ? '' : rest.slice(b + 1) } : { field, op }
}

export function filteredTableUrl(dbId: string, entity: string, filters: RowFilter[]): string {
  const p = new URLSearchParams()
  for (const f of filters) p.append('f', encodeFilter(f))
  return `/db/${dbId}/table/${encodeURIComponent(entity)}?${p.toString()}`
}

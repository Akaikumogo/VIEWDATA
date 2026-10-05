import type {
  ConnectionInfo,
  EntityStat,
  FieldMeta,
  IndexInfo,
  RowFilter,
  RowsQuery,
  SchemaInfo
} from '../../shared/types'

export interface StatsResult {
  sizeBytes: number | null
  entities: EntityStat[]
}

export type FetchRowsOptions = RowsQuery

export interface RawQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number | null
  command?: string
}

export interface DbAdapter {
  connect(): Promise<void>
  close(): Promise<void>
  ping(): Promise<string | undefined>
  getSchema(): Promise<SchemaInfo>
  getStats(): Promise<StatsResult>
  getIndexes(): Promise<IndexInfo[]>
  fetchRows(entity: string, opts: FetchRowsOptions): Promise<Record<string, unknown>[]>
  countRows(entity: string, filters?: RowFilter[]): Promise<{ total: number | null; estimate: boolean }>
  fetchByValues(entity: string, key: string, values: unknown[]): Promise<Record<string, unknown>[]>
  countWhere(entity: string, field: string, value: unknown): Promise<number | null>
  /** Converts a value coming from the UI (always a string) to what the driver should compare against */
  coerceKey(entity: string, field: string, value: string): unknown[]
  runQuery(text: string, opts: { limit: number; readOnly: boolean }): Promise<RawQueryResult>
  updateRow(entity: string, key: string, keyValues: unknown[], changes: Record<string, unknown>): Promise<number>
}

export interface AdapterContext {
  info: ConnectionInfo
  password: string
}

export function primaryKeyOf(fields: FieldMeta[]): string | null {
  return fields.find((f) => f.isPrimary)?.name ?? null
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return Number(v)
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** SQL values for writes: nested objects/arrays are stored as JSON text */
export function sqlValue(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) return JSON.stringify(v)
  return v
}

const READ_KEYWORDS = new Set(['select', 'with', 'show', 'explain', 'describe', 'desc', 'pragma', 'values', 'table'])

/** First keyword of a statement, ignoring leading comments and parentheses */
export function leadingKeyword(sql: string): string {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/^\(+/, '')
  return (stripped.match(/^[a-zA-Z]+/)?.[0] ?? '').toLowerCase()
}

export function assertReadOnly(sql: string): void {
  const kw = leadingKeyword(sql)
  if (!READ_KEYWORDS.has(kw)) {
    throw new Error(`This connection is read-only. "${kw.toUpperCase() || 'statement'}" is blocked; enable "Allow writes" in the connection settings.`)
  }
}

export interface SqlDialect {
  q(id: string): string
  ph(index: number): string
  contains(column: string, placeholder: string): string
}

/** Builds a WHERE clause from UI filters; placeholders continue from `start` */
export function buildWhere(
  filters: RowFilter[] | undefined,
  d: SqlDialect,
  start = 0
): { sql: string; params: unknown[] } {
  if (!filters?.length) return { sql: '', params: [] }
  const parts: string[] = []
  const params: unknown[] = []
  for (const f of filters) {
    const col = d.q(f.field)
    const next = () => d.ph(start + params.length)
    switch (f.op) {
      case 'null':
        parts.push(`${col} IS NULL`)
        break
      case 'notnull':
        parts.push(`${col} IS NOT NULL`)
        break
      case 'contains': {
        const p = next()
        params.push(`%${f.value ?? ''}%`)
        parts.push(d.contains(col, p))
        break
      }
      default: {
        const op = f.op === 'eq' ? '=' : f.op === 'neq' ? '<>' : f.op === 'gt' ? '>' : '<'
        const p = next()
        params.push(f.value ?? '')
        parts.push(`${col} ${op} ${p}`)
      }
    }
  }
  return { sql: ` WHERE ${parts.join(' AND ')}`, params }
}

export function orderClause(q: (id: string) => string, field: string | null | undefined, dir?: 'asc' | 'desc'): string {
  return field ? ` ORDER BY ${q(field)} ${dir === 'desc' ? 'DESC' : 'ASC'}` : ''
}

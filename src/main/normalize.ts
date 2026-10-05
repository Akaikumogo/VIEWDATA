import type { CellValue, FieldMeta } from '../shared/types'

const MAX_DEPTH = 6

/** Turns arbitrary driver values (BigInt, Buffer, Date, ObjectId, Decimal128, LOBs...) into IPC-safe JSON values */
export function normalizeValue(v: unknown, depth = 0): CellValue {
  if (v === null || v === undefined) return null
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v
    case 'number':
      return Number.isFinite(v) ? v : String(v)
    case 'bigint':
      return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
    case 'function':
    case 'symbol':
      return null
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    const buf = Buffer.from(v as Uint8Array)
    return `0x${buf.subarray(0, 32).toString('hex')}${buf.length > 32 ? `… (${buf.length} B)` : ''}`
  }
  const obj = v as Record<string, unknown> & { _bsontype?: string; toHexString?: () => string }
  if (obj._bsontype === 'ObjectId' && typeof obj.toHexString === 'function') return obj.toHexString()
  if (obj._bsontype) return String(obj)
  if (depth >= MAX_DEPTH) return '[…]'
  if (Array.isArray(v)) return v.map((x) => normalizeValue(x, depth + 1))
  const out: Record<string, CellValue> = {}
  for (const [k, val] of Object.entries(obj)) out[k] = normalizeValue(val, depth + 1)
  return out
}

export function normalizeRow(row: Record<string, unknown>): Record<string, CellValue> {
  const out: Record<string, CellValue> = {}
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v)
  return out
}

/** Stable string key for matching FK values with target rows */
export function keyOf(v: unknown): string {
  const n = normalizeValue(v)
  if (n === null) return ''
  return typeof n === 'object' ? JSON.stringify(n) : String(n)
}

const PREFERRED = [
  'name',
  'full_name',
  'fullname',
  'display_name',
  'title',
  'label',
  'username',
  'user_name',
  'login',
  'email',
  'first_name',
  'firstname',
  'last_name',
  'code',
  'slug',
  'sku',
  'number',
  'description'
]

const TEXT_TYPE = /char|text|string|varchar|clob|citext|enum/i

/** Guesses which column best represents a row in human terms (e.g. "name" for a users table) */
export function guessDisplayField(fields: FieldMeta[]): string | null {
  const byLower = new Map(fields.map((f) => [f.name.toLowerCase(), f.name]))
  for (const p of PREFERRED) {
    const hit = byLower.get(p)
    if (hit) return hit
  }
  for (const f of fields) {
    const l = f.name.toLowerCase()
    if ((l.endsWith('name') || l.endsWith('title')) && !f.isPrimary) return f.name
  }
  const text = fields.find((f) => !f.isPrimary && TEXT_TYPE.test(f.type) && !/(_id|id)$/i.test(f.name))
  return text?.name ?? null
}

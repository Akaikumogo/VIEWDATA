import type { ColumnProfile, DbKind, HealthReport, ProfileResult, Relation } from '../shared/types'
import { adapterFor } from './adapters'
import { keyOf, normalizeValue } from './normalize'
import { getSchema } from './services'
import * as store from './store'

const PROFILE_SAMPLE = 5000
const ORPHAN_SAMPLE = 500

function quoteFor(kind: DbKind): (id: string) => string {
  if (kind === 'mysql' || kind === 'mariadb') return (id) => '`' + id.replace(/`/g, '``') + '`'
  return (id) => '"' + id.replace(/"/g, '""') + '"'
}

function indexSuggestion(kind: DbKind, r: Relation): string {
  if (kind === 'mongodb') return `db.getCollection(${JSON.stringify(r.from)}).createIndex({ ${JSON.stringify(r.fromField)}: 1 })`
  const q = quoteFor(kind)
  const table = r.from
    .split('.')
    .map((p) => q(p))
    .join('.')
  const name = `idx_${r.from.split('.').pop()}_${r.fromField}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60)
  return `CREATE INDEX ${q(name)} ON ${table} (${q(r.fromField)});`
}

export async function getHealth(connectionId: string): Promise<HealthReport> {
  const row = store.getConnection(connectionId)
  if (!row) throw new Error('Connection not found')
  const [adapter, schema] = await Promise.all([adapterFor(connectionId), getSchema(connectionId)])
  const indexes = await adapter.getIndexes()
  const leading = new Set(indexes.filter((i) => i.columns.length).map((i) => `${i.entity}\u0000${i.columns[0]}`))
  const missingFkIndexes = schema.relations
    .filter((r) => !r.fromField.includes('.') || row.info.kind === 'mongodb')
    .filter((r) => !leading.has(`${r.from}\u0000${r.fromField}`))
    .map((relation) => ({ relation, suggestion: indexSuggestion(row.info.kind, relation) }))
  const tablesWithoutPk = schema.entities
    .filter((e) => e.kind === 'table' && !e.fields.some((f) => f.isPrimary))
    .map((e) => e.name)
  return { missingFkIndexes, tablesWithoutPk, indexCount: indexes.length, checkedAt: Date.now() }
}

function label(v: unknown): string {
  const n = normalizeValue(v)
  if (n === null) return 'null'
  return typeof n === 'object' ? JSON.stringify(n).slice(0, 80) : String(n).slice(0, 80)
}

export async function profileEntity(connectionId: string, entity: string): Promise<ProfileResult> {
  const [adapter, schema] = await Promise.all([adapterFor(connectionId), getSchema(connectionId)])
  const meta = schema.entities.find((e) => e.name === entity)
  if (!meta) throw new Error(`Unknown entity "${entity}"`)
  const rows = await adapter.fetchRows(entity, { limit: PROFILE_SAMPLE, offset: 0 })

  const fieldNames = meta.fields.filter((f) => !f.name.includes('.')).map((f) => f.name)
  const columns: ColumnProfile[] = fieldNames.map((field) => {
    let nulls = 0
    const counts = new Map<string, number>()
    for (const r of rows) {
      const v = r[field]
      if (v === null || v === undefined) {
        nulls++
        continue
      }
      const k = label(v)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([value, count]) => ({ value, count }))
    return { field, nullPct: rows.length ? nulls / rows.length : 0, distinct: counts.size, top }
  })

  const orphans = await Promise.all(
    schema.relations
      .filter((r) => r.from === entity && !r.fromField.includes('.'))
      .map(async (relation) => {
        const unique = new Map<string, unknown>()
        for (const r of rows) {
          const v = r[relation.fromField]
          if (v === null || v === undefined) continue
          for (const x of Array.isArray(v) ? v : [v]) {
            const k = keyOf(x)
            if (k && !unique.has(k) && unique.size < ORPHAN_SAMPLE) unique.set(k, x)
          }
        }
        const found = new Set<string>()
        if (unique.size) {
          const targets = await adapter.fetchByValues(relation.to, relation.toField, [...unique.values()]).catch(() => null)
          if (!targets) return { relation, checked: 0, missing: 0, examples: [] }
          for (const t of targets) found.add(keyOf(t[relation.toField]))
        }
        const missingKeys = [...unique.keys()].filter((k) => !found.has(k))
        return { relation, checked: unique.size, missing: missingKeys.length, examples: missingKeys.slice(0, 5) }
      })
  )

  return { entity, sampled: rows.length, columns, orphans }
}

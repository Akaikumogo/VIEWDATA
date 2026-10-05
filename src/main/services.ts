import {
  type CellValue,
  type ConnectionDetail,
  type EntityMeta,
  type FieldChange,
  type FieldMeta,
  type FkColumn,
  type Overview,
  type QueryResult,
  type RecordDetail,
  type RowsQuery,
  type RowsResult,
  type SchemaChange,
  type SchemaInfo,
  type TopEntity,
  writesAllowed
} from '../shared/types'
import { adapterFor } from './adapters'
import { type DbAdapter, leadingKeyword } from './adapters/types'
import { guessDisplayField, keyOf, normalizeRow, normalizeValue } from './normalize'
import * as store from './store'

const DAY = 86_400_000

export async function getSchema(connectionId: string, force = false): Promise<SchemaInfo> {
  if (!force) {
    const cached = store.getCachedSchema(connectionId)
    if (cached) return cached
  }
  const adapter = await adapterFor(connectionId)
  const schema = await adapter.getSchema()
  store.setCachedSchema(connectionId, schema)
  recordSchemaSignature(connectionId, schema)
  return schema
}

function requireEntity(schema: SchemaInfo, entity: string) {
  const meta = schema.entities.find((e) => e.name === entity)
  if (!meta) throw new Error(`Unknown entity "${entity}"`)
  return meta
}

function sanitizeQuery(meta: EntityMeta, q: RowsQuery): RowsQuery {
  const known = new Set(meta.fields.map((f) => f.name))
  const loose = meta.kind === 'collection'
  const ok = (f: string) => loose || known.has(f)
  return {
    limit: Math.min(Math.max(1, q.limit | 0), 1000),
    offset: Math.max(0, q.offset | 0),
    orderBy: q.orderBy && ok(q.orderBy) ? q.orderBy : null,
    orderDir: q.orderDir === 'desc' ? 'desc' : 'asc',
    filters: (q.filters ?? []).filter((f) => ok(f.field)).slice(0, 12)
  }
}

function displayFieldFor(
  schema: SchemaInfo,
  overrides: Record<string, string>,
  entity: string
): string | null {
  const fields = schema.entities.find((e) => e.name === entity)?.fields ?? []
  const o = overrides[entity]
  if (o && fields.some((f) => f.name === o)) return o
  return guessDisplayField(fields)
}

/** Resolves FK values to the human label of the referenced row, one batched query per relation */
async function resolveLabels(
  adapter: DbAdapter,
  target: string,
  key: string,
  displayField: string | null,
  rawValues: unknown[]
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {}
  if (!displayField || !rawValues.length) return labels
  const unique = new Map<string, unknown>()
  for (const v of rawValues) {
    if (v === null || v === undefined) continue
    for (const x of Array.isArray(v) ? v : [v]) {
      const k = keyOf(x)
      if (k && !unique.has(k)) unique.set(k, x)
    }
  }
  if (!unique.size) return labels
  const rows = await adapter.fetchByValues(target, key, [...unique.values()]).catch(() => [])
  for (const r of rows) {
    const label = normalizeValue(r[displayField])
    if (label !== null && label !== '') labels[keyOf(r[key])] = typeof label === 'object' ? JSON.stringify(label) : String(label)
  }
  return labels
}

export async function fetchRows(connectionId: string, entity: string, query: RowsQuery): Promise<RowsResult> {
  const [adapter, schema] = await Promise.all([adapterFor(connectionId), getSchema(connectionId)])
  const meta = requireEntity(schema, entity)
  const overrides = store.getDisplayFields(connectionId)
  const q = sanitizeQuery(meta, query)

  const [raw, count] = await Promise.all([
    adapter.fetchRows(entity, q),
    adapter.countRows(entity, q.filters).catch(() => ({ total: null, estimate: true }))
  ])

  const fkColumns: FkColumn[] = await Promise.all(
    schema.relations
      .filter((r) => r.from === entity && !r.fromField.includes('.'))
      .map(async (relation) => {
        const displayField = displayFieldFor(schema, overrides, relation.to)
        const labels = await resolveLabels(
          adapter,
          relation.to,
          relation.toField,
          displayField,
          raw.map((row) => row[relation.fromField])
        )
        return { field: relation.fromField, relation, displayField, labels }
      })
  )

  let fields: FieldMeta[] = meta.fields
  if (meta.kind === 'collection') {
    fields = meta.fields.filter((f) => !f.name.includes('.'))
    const seen = new Set(fields.map((f) => f.name))
    for (const row of raw) {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) {
          seen.add(k)
          fields.push({ name: k, type: 'mixed', nullable: true, isPrimary: false })
        }
      }
    }
  }

  return {
    rows: raw.map(normalizeRow),
    total: count.total,
    totalIsEstimate: count.estimate,
    fields,
    fkColumns
  }
}

export async function getRecord(
  connectionId: string,
  entity: string,
  key: string,
  value: string
): Promise<RecordDetail> {
  const [adapter, schema] = await Promise.all([adapterFor(connectionId), getSchema(connectionId)])
  const meta = schema.entities.find((e) => e.name === entity)
  const overrides = store.getDisplayFields(connectionId)
  const variants = adapter.coerceKey(entity, key, value)
  const rawRow = (await adapter.fetchByValues(entity, key, variants))[0] ?? null
  const displayField = displayFieldFor(schema, overrides, entity)

  const outgoing = rawRow
    ? await Promise.all(
        schema.relations
          .filter((r) => r.from === entity && !r.fromField.includes('.'))
          .filter((r) => rawRow[r.fromField] !== null && rawRow[r.fromField] !== undefined)
          .map(async (relation) => {
            const v = rawRow[relation.fromField]
            const first = Array.isArray(v) ? v[0] : v
            const df = displayFieldFor(schema, overrides, relation.to)
            const labels = await resolveLabels(adapter, relation.to, relation.toField, df, [first])
            const k = keyOf(first)
            return { relation, value: k, label: labels[k] ?? null }
          })
      )
    : []

  const incoming = rawRow
    ? await Promise.all(
        schema.relations
          .filter((r) => r.to === entity)
          .map(async (relation) => {
            const target = rawRow[relation.toField]
            const count = await adapter
              .countWhere(relation.from, relation.fromField, target)
              .catch(() => null)
            return { relation, count }
          })
      )
    : []

  return {
    entity,
    key,
    value,
    row: rawRow ? normalizeRow(rawRow) : null,
    displayField,
    fields: meta?.fields.filter((f) => !f.name.includes('.')) ?? [],
    outgoing,
    incoming: incoming.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
  }
}

export function getOverview(): Overview {
  const connections = store.listConnections()
  const latest: Overview['latest'] = {}
  const topEntities: TopEntity[] = []
  for (const c of connections) {
    latest[c.id] = store.latestSnapshot(c.id)
    for (const e of store.latestEntityStats(c.id)) {
      topEntities.push({ ...e, connectionId: c.id, connectionName: c.name, kind: c.kind })
    }
  }
  topEntities.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || (b.rowCount ?? 0) - (a.rowCount ?? 0))
  return {
    connections,
    latest,
    history: store.snapshotHistory(null, Date.now() - 30 * DAY),
    topEntities: topEntities.slice(0, 12)
  }
}

export function getConnectionDetail(connectionId: string): ConnectionDetail {
  const row = store.getConnection(connectionId)
  if (!row) throw new Error('Connection not found')
  return {
    connection: row.info,
    latest: store.latestSnapshot(connectionId),
    history: store.snapshotHistory(connectionId, Date.now() - 30 * DAY),
    entityStats: store.latestEntityStats(connectionId),
    entityHistory: store.entityHistory(connectionId, Date.now() - 30 * DAY)
  }
}

/* ---------- query editor ---------- */

const DDL_KEYWORDS = new Set(['create', 'alter', 'drop', 'rename', 'truncate'])

export async function runQuery(connectionId: string, text: string, limit: number): Promise<QueryResult> {
  const row = store.getConnection(connectionId)
  if (!row) throw new Error('Connection not found')
  const max = Math.min(Math.max(1, limit | 0), 10_000)
  const started = Date.now()
  try {
    const adapter = await adapterFor(connectionId)
    const res = await adapter.runQuery(text, { limit: max, readOnly: !writesAllowed(row.info) })
    const durationMs = Date.now() - started
    const truncated = res.rows.length > max
    const rows = res.rows.slice(0, max).map(normalizeRow)
    store.addQueryHistory(connectionId, { text, ranAt: started, durationMs, ok: true, rowCount: res.rowCount })
    if (DDL_KEYWORDS.has(leadingKeyword(text))) await getSchema(connectionId, true).catch(() => null)
    return { columns: res.columns, rows, rowCount: res.rowCount, command: res.command, durationMs, truncated }
  } catch (err) {
    store.addQueryHistory(connectionId, {
      text,
      ranAt: started,
      durationMs: Date.now() - started,
      ok: false,
      error: (err as Error).message,
      rowCount: null
    })
    throw err
  }
}

/* ---------- row editing ---------- */

export async function updateRow(
  connectionId: string,
  entity: string,
  key: string,
  value: string,
  changes: Record<string, CellValue>
): Promise<number> {
  const row = store.getConnection(connectionId)
  if (!row) throw new Error('Connection not found')
  if (!writesAllowed(row.info)) throw new Error('This connection is read-only. Enable "Allow writes" in its settings.')
  const [adapter, schema] = await Promise.all([adapterFor(connectionId), getSchema(connectionId)])
  const meta = requireEntity(schema, entity)
  const known = new Set(meta.fields.map((f) => f.name))
  const clean: Record<string, unknown> = {}
  for (const [f, v] of Object.entries(changes)) {
    if (f === key) continue
    if (meta.kind !== 'collection' && !known.has(f)) throw new Error(`Unknown column "${f}"`)
    clean[f] = v
  }
  return adapter.updateRow(entity, key, adapter.coerceKey(entity, key, value), clean)
}

/* ---------- schema history ---------- */

/** Stable, noise-free representation of a schema used for change tracking */
function signatureOf(schema: SchemaInfo): string {
  const entities: Record<string, Record<string, string>> = {}
  for (const e of [...schema.entities].sort((a, b) => a.name.localeCompare(b.name))) {
    const fields: Record<string, string> = {}
    for (const f of e.fields) {
      // sampled Mongo fields flicker; only track the ones present in nearly every document
      if (e.kind === 'collection') {
        if ((f.frequency ?? 1) >= 0.95 && !f.name.includes('.')) fields[f.name] = ''
      } else fields[f.name] = f.type
    }
    entities[e.name] = fields
  }
  const relations = schema.relations
    .filter((r) => r.confidence >= 0.9)
    .map((r) => `${r.from}.${r.fromField} -> ${r.to}.${r.toField}`)
    .sort()
  return JSON.stringify({ entities, relations })
}

function recordSchemaSignature(connectionId: string, schema: SchemaInfo): void {
  const sig = signatureOf(schema)
  if (store.lastSchemaSignature(connectionId) !== sig) store.addSchemaSignature(connectionId, sig)
}

export async function getSchemaChanges(connectionId: string): Promise<SchemaChange[]> {
  const list = store.listSchemaSignatures(connectionId)
  if (!list.length) {
    recordSchemaSignature(connectionId, await getSchema(connectionId))
    return getSchemaChanges(connectionId)
  }
  type Sig = { entities: Record<string, Record<string, string>>; relations: string[] }
  const out: SchemaChange[] = []
  let prev: Sig | null = null
  for (const item of list) {
    const cur = JSON.parse(item.json) as Sig
    if (!prev) {
      out.push({
        takenAt: item.takenAt,
        baseline: true,
        entitiesAdded: Object.keys(cur.entities),
        entitiesRemoved: [],
        fieldChanges: [],
        relationsAdded: [],
        relationsRemoved: []
      })
    } else {
      const fieldChanges: FieldChange[] = []
      for (const [name, fields] of Object.entries(cur.entities)) {
        const before = prev.entities[name]
        if (!before) continue
        const added = Object.keys(fields).filter((f) => !(f in before))
        const removed = Object.keys(before).filter((f) => !(f in fields))
        const changed = Object.keys(fields)
          .filter((f) => f in before && before[f] !== fields[f])
          .map((f) => ({ field: f, from: before[f], to: fields[f] }))
        if (added.length || removed.length || changed.length) fieldChanges.push({ entity: name, added, removed, changed })
      }
      const prevRel = new Set(prev.relations)
      const curRel = new Set(cur.relations)
      out.push({
        takenAt: item.takenAt,
        baseline: false,
        entitiesAdded: Object.keys(cur.entities).filter((n) => !prev!.entities[n]),
        entitiesRemoved: Object.keys(prev.entities).filter((n) => !cur.entities[n]),
        fieldChanges,
        relationsAdded: cur.relations.filter((r) => !prevRel.has(r)),
        relationsRemoved: prev.relations.filter((r) => !curRel.has(r))
      })
    }
    prev = cur
  }
  return out.reverse()
}

import { BSON, type Db, type Document, MongoClient, ObjectId } from 'mongodb'
import type { EntityMeta, FieldMeta, IndexInfo, Relation, RowFilter, SchemaInfo } from '../../shared/types'
import {
  type AdapterContext,
  type DbAdapter,
  type FetchRowsOptions,
  type RawQueryResult,
  type StatsResult,
  toNumber
} from './types'

const SAMPLE_SIZE = 150
const VERIFY_SIZE = 25
const MIN_CONFIDENCE = 0.5
const MAX_DEPTH = 2

interface FieldProfile {
  count: number
  types: Map<string, number>
  objectIds: ObjectId[]
  scalars: unknown[]
}

function bsonType(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (v instanceof ObjectId) return 'objectId'
  if (v instanceof Date) return 'date'
  if (Array.isArray(v)) {
    const first = v.find((x) => x !== null && x !== undefined)
    return first === undefined ? 'array' : `array<${bsonType(first)}>`
  }
  const bt = (v as { _bsontype?: string })._bsontype
  if (bt) return bt.toLowerCase()
  return typeof v === 'object' ? 'object' : typeof v
}

function singular(name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('ies')) return n.slice(0, -3) + 'y'
  if (n.endsWith('ses') || n.endsWith('xes')) return n.slice(0, -2)
  if (n.endsWith('s')) return n.slice(0, -1)
  return n
}

/** "customerId" / "customer_id" / "customerIds" / "customer" -> "customer" */
function refStem(field: string): string {
  const last = field.split('.').pop() ?? field
  return singular(last.replace(/(_ids?|Ids?|_ref|Ref)$/, '')).replace(/[_-]/g, '')
}

export class MongoAdapter implements DbAdapter {
  private client: MongoClient | null = null
  private db: Db | null = null
  private idTypes = new Map<string, string>()

  constructor(private ctx: AdapterContext) {}

  private buildUri(): string {
    const { info, password } = this.ctx
    if (info.options.uri?.trim()) return info.options.uri.trim()
    const auth = info.username
      ? `${encodeURIComponent(info.username)}:${encodeURIComponent(password)}@`
      : ''
    const params = new URLSearchParams()
    if (info.username) params.set('authSource', 'admin')
    if (info.options.ssl) params.set('tls', 'true')
    const qs = params.toString()
    return `mongodb://${auth}${info.host}:${info.port}/${info.database}${qs ? `?${qs}` : ''}`
  }

  async connect(): Promise<void> {
    this.client = new MongoClient(this.buildUri(), {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      maxPoolSize: 4
    })
    await this.client.connect()
    this.db = this.client.db(this.ctx.info.database || undefined)
    await this.ping()
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {})
    this.client = null
    this.db = null
  }

  private get d(): Db {
    if (!this.db) throw new Error('Not connected')
    return this.db
  }

  async ping(): Promise<string | undefined> {
    const info = await this.d.admin().command({ buildInfo: 1 }).catch(() => null)
    if (!info) await this.d.command({ ping: 1 })
    return info?.version ? `MongoDB ${info.version}` : undefined
  }

  private async collections(): Promise<string[]> {
    const list = await this.d.listCollections({ type: 'collection' }, { nameOnly: true }).toArray()
    return list.map((c) => c.name).filter((n) => !n.startsWith('system.')).sort()
  }

  private profile(docs: Document[]): Map<string, FieldProfile> {
    const out = new Map<string, FieldProfile>()
    const visit = (obj: Document, prefix: string, depth: number): void => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k
        let p = out.get(path)
        if (!p) {
          p = { count: 0, types: new Map(), objectIds: [], scalars: [] }
          out.set(path, p)
        }
        p.count++
        const t = bsonType(v)
        p.types.set(t, (p.types.get(t) ?? 0) + 1)
        if (v instanceof ObjectId) p.objectIds.push(v)
        else if (Array.isArray(v)) {
          for (const x of v.slice(0, 5)) {
            if (x instanceof ObjectId) p.objectIds.push(x)
            else if (typeof x === 'string' || typeof x === 'number') p.scalars.push(x)
          }
        } else if (typeof v === 'string' || typeof v === 'number') p.scalars.push(v)
        if (t === 'object' && depth < MAX_DEPTH) visit(v as Document, path, depth + 1)
      }
    }
    for (const doc of docs) visit(doc, '', 0)
    return out
  }

  async getSchema(): Promise<SchemaInfo> {
    const names = await this.collections()
    const stats = await this.getStats()
    const statMap = new Map(stats.entities.map((e) => [e.entity, e]))

    const profiles = new Map<string, Map<string, FieldProfile>>()
    const entities: EntityMeta[] = []
    for (const name of names) {
      const docs = await this.d
        .collection(name)
        .aggregate([{ $sample: { size: SAMPLE_SIZE } }], { maxTimeMS: 15_000 })
        .toArray()
        .catch(() => this.d.collection(name).find().limit(SAMPLE_SIZE).toArray())
      const prof = this.profile(docs)
      profiles.set(name, prof)

      const fields: FieldMeta[] = [...prof.entries()]
        .map(([path, p]) => {
          const dominant = [...p.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'null'
          const freq = docs.length ? p.count / docs.length : 0
          return {
            name: path,
            type: p.types.size > 1 ? `${dominant} | mixed` : dominant,
            nullable: freq < 1 || p.types.has('null'),
            isPrimary: path === '_id',
            frequency: Math.round(freq * 100) / 100
          }
        })
        .sort((a, b) => (a.isPrimary ? -1 : b.isPrimary ? 1 : 0))
      if (!fields.some((f) => f.isPrimary)) {
        fields.unshift({ name: '_id', type: 'objectId', nullable: false, isPrimary: true })
      }
      this.idTypes.set(name, fields.find((f) => f.isPrimary)?.type ?? 'objectId')

      const s = statMap.get(name)
      entities.push({
        name,
        kind: 'collection',
        fields,
        rowCount: s?.rowCount ?? null,
        sizeBytes: s?.sizeBytes ?? null,
        indexCount: s?.indexCount ?? null
      })
    }

    const relations = await this.inferRelations(names, profiles)
    return { entities, relations, fetchedAt: Date.now() }
  }

  /**
   * MongoDB has no foreign keys, so relations are inferred:
   * candidate fields hold ObjectIds or look like references by name (userId, user_ids...),
   * then sampled values are looked up in candidate collections and the hit ratio becomes the confidence.
   */
  private async inferRelations(
    names: string[],
    profiles: Map<string, Map<string, FieldProfile>>
  ): Promise<Relation[]> {
    const byStem = new Map<string, string[]>()
    for (const n of names) {
      const stem = singular(n).replace(/[_-]/g, '')
      byStem.set(stem, [...(byStem.get(stem) ?? []), n])
    }

    const relations: Relation[] = []
    for (const [from, prof] of profiles) {
      for (const [path, p] of prof) {
        if (path === '_id' || path.endsWith('._id')) continue
        const nameLooksLikeRef = /(_ids?|Ids?|_ref|Ref)$/.test(path)
        const hasOids = p.objectIds.length > 0
        if (!hasOids && !nameLooksLikeRef) continue

        const sample: unknown[] = hasOids
          ? [...new Map(p.objectIds.map((o) => [o.toHexString(), o])).values()].slice(0, VERIFY_SIZE)
          : [...new Set(p.scalars)].slice(0, VERIFY_SIZE)
        if (!sample.length) continue

        const stem = refStem(path)
        const named = byStem.get(stem) ?? names.filter((n) => singular(n).includes(stem) && stem.length > 2)
        // ObjectIds are globally unique, so scanning every collection is safe when no name matches
        const candidates = named.length ? named : hasOids ? names.filter((n) => n !== from) : []

        let best: { to: string; ratio: number } | null = null
        for (const to of candidates.slice(0, 40)) {
          const found = await this.d
            .collection(to)
            .countDocuments({ _id: { $in: sample as ObjectId[] } }, { maxTimeMS: 5_000 })
            .catch(() => 0)
          const ratio = found / sample.length
          if (!best || ratio > best.ratio) best = { to, ratio }
          if (ratio === 1) break
        }
        if (best && best.ratio >= MIN_CONFIDENCE) {
          relations.push({
            id: `inferred:${from}.${path}->${best.to}`,
            from,
            fromField: path,
            to: best.to,
            toField: '_id',
            confidence: Math.round(best.ratio * 100) / 100
          })
        }
      }
    }
    return relations
  }

  async getStats(): Promise<StatsResult> {
    const names = await this.collections()
    const dbStats = await this.d.command({ dbStats: 1 }).catch(() => null)
    const entities = await Promise.all(
      names.map(async (name) => {
        const coll = this.d.collection(name)
        const [rowCount, storage] = await Promise.all([
          coll.estimatedDocumentCount().catch(() => null),
          coll
            .aggregate([{ $collStats: { storageStats: {} } }])
            .toArray()
            .then((r) => r[0]?.storageStats as Document | undefined)
            .catch(() => undefined)
        ])
        return {
          entity: name,
          rowCount,
          sizeBytes: storage ? (toNumber(storage.storageSize) ?? 0) + (toNumber(storage.totalIndexSize) ?? 0) : null,
          indexCount: storage ? toNumber(storage.nindexes) : null
        }
      })
    )
    const size = dbStats
      ? (toNumber(dbStats.storageSize) ?? 0) + (toNumber(dbStats.indexSize) ?? 0)
      : entities.reduce((s, e) => s + (e.sizeBytes ?? 0), 0)
    return { sizeBytes: size, entities }
  }

  private toFilter(filters: RowFilter[] | undefined): Document {
    if (!filters?.length) return {}
    const and: Document[] = []
    for (const f of filters) {
      const v = f.value ?? ''
      const num = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null
      switch (f.op) {
        case 'eq':
          and.push({ [f.field]: { $in: this.coerceKey('', f.field, v) } })
          break
        case 'neq':
          and.push({ [f.field]: { $nin: this.coerceKey('', f.field, v) } })
          break
        case 'contains':
          and.push({ [f.field]: { $regex: v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })
          break
        case 'gt':
          and.push({ [f.field]: { $gt: num ?? v } })
          break
        case 'lt':
          and.push({ [f.field]: { $lt: num ?? v } })
          break
        case 'null':
          and.push({ [f.field]: null })
          break
        case 'notnull':
          and.push({ [f.field]: { $ne: null } })
      }
    }
    return and.length === 1 ? and[0] : { $and: and }
  }

  async fetchRows(entity: string, opts: FetchRowsOptions): Promise<Record<string, unknown>[]> {
    const dir = opts.orderDir === 'desc' ? -1 : 1
    return this.d
      .collection(entity)
      .find(this.toFilter(opts.filters), { maxTimeMS: 30_000 })
      .sort(opts.orderBy ? { [opts.orderBy]: dir } : { _id: dir })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray()
  }

  async countRows(entity: string, filters?: RowFilter[]): Promise<{ total: number | null; estimate: boolean }> {
    const coll = this.d.collection(entity)
    if (filters?.length) {
      const n = await coll.countDocuments(this.toFilter(filters), { maxTimeMS: 15_000 })
      return { total: n, estimate: false }
    }
    return { total: await coll.estimatedDocumentCount(), estimate: true }
  }

  async getIndexes(): Promise<IndexInfo[]> {
    const out: IndexInfo[] = []
    for (const name of await this.collections()) {
      const list = await this.d.collection(name).indexes().catch(() => [])
      for (const ix of list) {
        out.push({ entity: name, name: String(ix.name), columns: Object.keys(ix.key ?? {}), unique: !!ix.unique })
      }
    }
    return out
  }

  /**
   * Queries are EJSON documents:
   * { "collection": "orders", "find": {...}, "sort": {...}, "projection": {...} }
   * { "collection": "orders", "aggregate": [ ... ] }
   */
  async runQuery(text: string, opts: { limit: number; readOnly: boolean }): Promise<RawQueryResult> {
    let spec: Document
    try {
      spec = BSON.EJSON.parse(text, { relaxed: true }) as Document
    } catch (err) {
      throw new Error(`Query must be JSON: ${(err as Error).message}`)
    }
    if (!spec || typeof spec !== 'object' || typeof spec.collection !== 'string') {
      throw new Error('Query must have a "collection" field, plus "find" or "aggregate"')
    }
    const coll = this.d.collection(spec.collection)
    let rows: Document[]
    if (Array.isArray(spec.aggregate)) {
      const stages = spec.aggregate as Document[]
      if (opts.readOnly && stages.some((s) => '$out' in s || '$merge' in s)) {
        throw new Error('This connection is read-only. $out and $merge are blocked.')
      }
      rows = await coll
        .aggregate([...stages, { $limit: opts.limit + 1 }], { maxTimeMS: 30_000 })
        .toArray()
    } else {
      let cursor = coll.find((spec.find ?? spec.filter ?? {}) as Document, { maxTimeMS: 30_000 })
      if (spec.projection) cursor = cursor.project(spec.projection as Document)
      if (spec.sort) cursor = cursor.sort(spec.sort as Document)
      if (typeof spec.skip === 'number') cursor = cursor.skip(spec.skip)
      const lim = typeof spec.limit === 'number' ? Math.min(spec.limit, opts.limit + 1) : opts.limit + 1
      rows = await cursor.limit(lim).toArray()
    }
    const cols = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) cols.add(k)
    return { columns: [...cols], rows, rowCount: rows.length }
  }

  async updateRow(entity: string, key: string, keyValues: unknown[], changes: Record<string, unknown>): Promise<number> {
    if (!Object.keys(changes).length) return 0
    const res = await this.d.collection(entity).updateOne({ [key]: { $in: keyValues } }, { $set: changes })
    return res.modifiedCount
  }

  async fetchByValues(entity: string, key: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    if (!values.length) return []
    return this.d
      .collection(entity)
      .find({ [key]: { $in: values } }, { maxTimeMS: 15_000 })
      .limit(values.length * 2)
      .toArray()
  }

  async countWhere(entity: string, field: string, value: unknown): Promise<number | null> {
    const variants = Array.isArray(value) ? value : [value]
    return this.d
      .collection(entity)
      .countDocuments({ [field]: { $in: variants } }, { maxTimeMS: 10_000 })
  }

  coerceKey(_entity: string, _field: string, value: string): unknown[] {
    const out: unknown[] = [value]
    if (/^[0-9a-f]{24}$/i.test(value)) out.unshift(new ObjectId(value))
    if (/^-?\d+(\.\d+)?$/.test(value)) out.push(Number(value))
    return out
  }
}

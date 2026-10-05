import * as mariadb from 'mariadb'
import mysql from 'mysql2/promise'
import type { EntityMeta, FieldMeta, IndexInfo, Relation, RowFilter, SchemaInfo } from '../../shared/types'
import {
  type AdapterContext,
  type DbAdapter,
  type FetchRowsOptions,
  type RawQueryResult,
  type SqlDialect,
  type StatsResult,
  assertReadOnly,
  buildWhere,
  orderClause,
  primaryKeyOf,
  sqlValue,
  toNumber
} from './types'

type Runner = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string, params?: unknown[]): Promise<number>
  raw(sql: string, readOnly: boolean): Promise<RawQueryResult>
  end(): Promise<void>
}

function qi(id: string): string {
  return '`' + id.replace(/`/g, '``') + '`'
}

const MY_DIALECT: SqlDialect = {
  q: qi,
  ph: () => '?',
  contains: (col, p) => `CAST(${col} AS CHAR) LIKE ${p}`
}

async function inReadOnly<T>(
  run: (sql: string) => Promise<unknown>,
  readOnly: boolean,
  body: () => Promise<T>
): Promise<T> {
  if (!readOnly) return body()
  await run('START TRANSACTION READ ONLY')
  try {
    return await body()
  } finally {
    await run('ROLLBACK').catch(() => {})
  }
}

async function mysqlRunner(ctx: AdapterContext): Promise<Runner> {
  const { info, password } = ctx
  const pool = mysql.createPool({
    host: info.host,
    port: info.port,
    database: info.database,
    user: info.username,
    password,
    ssl: info.options.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 4,
    connectTimeout: 10_000,
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: false
  })
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.query(sql, params)
      return rows as T[]
    },
    async exec(sql: string, params: unknown[] = []) {
      const [res] = await pool.query(sql, params)
      return (res as { affectedRows?: number }).affectedRows ?? 0
    },
    async raw(sql: string, readOnly: boolean) {
      const conn = await pool.getConnection()
      try {
        return await inReadOnly((s) => conn.query(s), readOnly, async () => {
          const [res, fields] = await conn.query(sql)
          if (Array.isArray(res)) {
            return {
              columns: Array.isArray(fields) ? (fields as { name: string }[]).map((f) => f.name) : Object.keys(res[0] ?? {}),
              rows: res as Record<string, unknown>[],
              rowCount: res.length
            }
          }
          return { columns: [], rows: [], rowCount: (res as { affectedRows?: number }).affectedRows ?? null }
        })
      } finally {
        conn.release()
      }
    },
    end: () => pool.end()
  }
}

async function mariaRunner(ctx: AdapterContext): Promise<Runner> {
  const { info, password } = ctx
  const config = {
    host: info.host,
    port: info.port,
    database: info.database,
    user: info.username,
    password,
    ssl: info.options.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10_000,
    bigIntAsNumber: true,
    decimalAsNumber: false,
    checkDuplicate: false
  }
  // the pool hides the real cause behind a generic timeout, so probe with a single connection first
  const probe = await mariadb.createConnection(config)
  await probe.end()
  const pool = mariadb.createPool({ ...config, connectionLimit: 4 })
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const rows = await pool.query(sql, params)
      return Array.from(rows as T[])
    },
    async exec(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params)
      return Number((res as { affectedRows?: number }).affectedRows ?? 0)
    },
    async raw(sql: string, readOnly: boolean) {
      const conn = await pool.getConnection()
      try {
        return await inReadOnly((s) => conn.query(s), readOnly, async () => {
          const res = await conn.query(sql)
          if (Array.isArray(res)) {
            const meta = (res as unknown as { meta?: { name(): string }[] }).meta
            const rows = Array.from(res as Record<string, unknown>[])
            return {
              columns: meta ? meta.map((m) => m.name()) : Object.keys(rows[0] ?? {}),
              rows,
              rowCount: rows.length
            }
          }
          return { columns: [], rows: [], rowCount: Number((res as { affectedRows?: number }).affectedRows ?? 0) }
        })
      } finally {
        conn.release()
      }
    },
    end: () => pool.end()
  }
}

export class MySqlAdapter implements DbAdapter {
  private db: Runner | null = null
  private pkCache = new Map<string, string | null>()
  private estimates = new Map<string, number>()

  constructor(
    private ctx: AdapterContext,
    private flavor: 'mysql' | 'mariadb'
  ) {}

  private get schema(): string {
    return this.ctx.info.database
  }

  async connect(): Promise<void> {
    if (!this.schema) throw new Error('Database name is required')
    this.db = this.flavor === 'mariadb' ? await mariaRunner(this.ctx) : await mysqlRunner(this.ctx)
    await this.ping()
  }

  async close(): Promise<void> {
    await this.db?.end().catch(() => {})
    this.db = null
  }

  private q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Not connected')
    return this.db.query<T>(sql, params)
  }

  async ping(): Promise<string | undefined> {
    const r = await this.q<{ v: string }>('SELECT VERSION() AS v')
    return r[0]?.v
  }

  async getSchema(): Promise<SchemaInfo> {
    const [tables, columns, fks, stats] = await Promise.all([
      this.q<{ t: string; type: string }>(
        'SELECT TABLE_NAME AS t, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
        [this.schema]
      ),
      this.q<{ t: string; c: string; type: string; nullable: string; ckey: string }>(
        `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS ckey
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [this.schema]
      ),
      this.q<{ name: string; t: string; c: string; rt: string; rc: string }>(
        `SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS t, COLUMN_NAME AS c,
                REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
           AND (REFERENCED_TABLE_SCHEMA = ? OR REFERENCED_TABLE_SCHEMA IS NULL)`,
        [this.schema, this.schema]
      ),
      this.getStats()
    ])

    const statMap = new Map(stats.entities.map((e) => [e.entity, e]))
    const fieldsByTable = new Map<string, FieldMeta[]>()
    for (const c of columns) {
      const list = fieldsByTable.get(c.t) ?? []
      list.push({ name: c.c, type: String(c.type), nullable: c.nullable === 'YES', isPrimary: c.ckey === 'PRI' })
      fieldsByTable.set(c.t, list)
    }

    const entities: EntityMeta[] = tables
      .map((t) => {
        const fields = fieldsByTable.get(t.t) ?? []
        this.pkCache.set(t.t, primaryKeyOf(fields))
        const s = statMap.get(t.t)
        return {
          name: t.t,
          kind: t.type === 'VIEW' ? ('view' as const) : ('table' as const),
          fields,
          rowCount: s?.rowCount ?? null,
          sizeBytes: s?.sizeBytes ?? null,
          indexCount: s?.indexCount ?? null
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const relations: Relation[] = fks.map((f) => ({
      id: `${f.name}:${f.t}.${f.c}`,
      from: f.t,
      fromField: f.c,
      to: f.rt,
      toField: f.rc,
      confidence: 1
    }))

    return { entities, relations, fetchedAt: Date.now() }
  }

  async getStats(): Promise<StatsResult> {
    const [tables, idx] = await Promise.all([
      this.q<{ t: string; rows: unknown; data: unknown; ix: unknown }>(
        `SELECT TABLE_NAME AS t, TABLE_ROWS AS \`rows\`, DATA_LENGTH AS data, INDEX_LENGTH AS ix
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
        [this.schema]
      ),
      this.q<{ t: string; n: unknown }>(
        `SELECT TABLE_NAME AS t, COUNT(DISTINCT INDEX_NAME) AS n
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? GROUP BY TABLE_NAME`,
        [this.schema]
      )
    ])
    const idxMap = new Map(idx.map((r) => [r.t, toNumber(r.n)]))
    let total = 0
    const entities = tables.map((r) => {
      const size = (toNumber(r.data) ?? 0) + (toNumber(r.ix) ?? 0)
      total += size
      const rowCount = toNumber(r.rows)
      if (rowCount !== null) this.estimates.set(r.t, rowCount)
      return { entity: r.t, rowCount, sizeBytes: size, indexCount: idxMap.get(r.t) ?? null }
    })
    return { sizeBytes: total, entities }
  }

  async fetchRows(entity: string, opts: FetchRowsOptions): Promise<Record<string, unknown>[]> {
    const where = buildWhere(opts.filters, MY_DIALECT)
    const order = orderClause(qi, opts.orderBy ?? this.pkCache.get(entity), opts.orderDir)
    return this.q(`SELECT * FROM ${qi(entity)}${where.sql}${order} LIMIT ? OFFSET ?`, [
      ...where.params,
      opts.limit,
      opts.offset
    ])
  }

  async countRows(entity: string, filters?: RowFilter[]): Promise<{ total: number | null; estimate: boolean }> {
    // InnoDB TABLE_ROWS is only an estimate; count exactly unless the table is large
    const est = this.estimates.get(entity)
    if (!filters?.length && est !== undefined && est > 500_000) return { total: est, estimate: true }
    const where = buildWhere(filters, MY_DIALECT)
    const r = await this.q<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${qi(entity)}${where.sql}`, where.params)
    return { total: toNumber(r[0]?.n), estimate: false }
  }

  async getIndexes(): Promise<IndexInfo[]> {
    const rows = await this.q<{ t: string; name: string; c: string; nu: unknown }>(
      `SELECT TABLE_NAME AS t, INDEX_NAME AS name, COLUMN_NAME AS c, NON_UNIQUE AS nu
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [this.schema]
    )
    const map = new Map<string, IndexInfo>()
    for (const r of rows) {
      const id = `${r.t}.${r.name}`
      const ix = map.get(id) ?? { entity: r.t, name: r.name, columns: [], unique: Number(r.nu) === 0 }
      ix.columns.push(r.c)
      map.set(id, ix)
    }
    return [...map.values()]
  }

  async runQuery(text: string, opts: { limit: number; readOnly: boolean }): Promise<RawQueryResult> {
    if (!this.db) throw new Error('Not connected')
    if (opts.readOnly) assertReadOnly(text)
    const res = await this.db.raw(text, opts.readOnly)
    return { ...res, rows: res.rows.slice(0, opts.limit + 1) }
  }

  async updateRow(entity: string, key: string, keyValues: unknown[], changes: Record<string, unknown>): Promise<number> {
    const fields = Object.keys(changes)
    if (!fields.length) return 0
    if (!this.db) throw new Error('Not connected')
    return this.db.exec(
      `UPDATE ${qi(entity)} SET ${fields.map((f) => `${qi(f)} = ?`).join(', ')} WHERE ${qi(key)} = ?`,
      [...fields.map((f) => sqlValue(changes[f])), keyValues[0]]
    )
  }

  async fetchByValues(entity: string, key: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    if (!values.length) return []
    return this.q(`SELECT * FROM ${qi(entity)} WHERE ${qi(key)} IN (${values.map(() => '?').join(', ')})`, values)
  }

  async countWhere(entity: string, field: string, value: unknown): Promise<number | null> {
    const r = await this.q<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${qi(entity)} WHERE ${qi(field)} = ?`, [value])
    return toNumber(r[0]?.n)
  }

  coerceKey(_entity: string, _field: string, value: string): unknown[] {
    return [value]
  }
}

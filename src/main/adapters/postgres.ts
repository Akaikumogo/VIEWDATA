import pg from 'pg'
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

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`

function qi(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"'
}

const PG_DIALECT: SqlDialect = {
  q: qi,
  ph: (i) => `$${i + 1}`,
  contains: (col, p) => `${col}::text ILIKE ${p}`
}

export class PostgresAdapter implements DbAdapter {
  private pool: pg.Pool | null = null
  private pkCache = new Map<string, string | null>()
  private estimates = new Map<string, number>()

  constructor(private ctx: AdapterContext) {}

  private get schemaFilter(): string | undefined {
    return this.ctx.info.options.schema?.trim() || undefined
  }

  /** entity names are "table" for public, "schema.table" otherwise */
  private entityName(schema: string, table: string): string {
    return schema === 'public' ? table : `${schema}.${table}`
  }

  private qualified(entity: string): string {
    const dot = entity.indexOf('.')
    if (dot === -1) return `${qi('public')}.${qi(entity)}`
    return `${qi(entity.slice(0, dot))}.${qi(entity.slice(dot + 1))}`
  }

  async connect(): Promise<void> {
    const { info, password } = this.ctx
    this.pool = new pg.Pool({
      host: info.host,
      port: info.port,
      database: info.database,
      user: info.username,
      password,
      ssl: info.options.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000
    })
    this.pool.on('error', () => {})
    try {
      await this.ping()
    } catch (err) {
      await this.close()
      throw await this.explain(err)
    }
  }

  /**
   * Servers with a non-UTF8 lc_messages (e.g. Russian on WIN1251) send startup errors
   * that arrive garbled, so known SQLSTATE codes are rewritten in plain English.
   */
  private async explain(err: unknown): Promise<Error> {
    const e = err as { code?: string; message?: string }
    const { info } = this.ctx
    switch (e.code) {
      case '3D000': {
        const names = await this.listDatabases().catch(() => [])
        const close = names.find((n) => n.toLowerCase() === info.database.toLowerCase())
        let msg = `Database "${info.database}" does not exist on ${info.host}:${info.port}.`
        if (close) msg += ` Did you mean "${close}"? Database names are case-sensitive.`
        else if (names.length) msg += ` Available: ${names.join(', ')}.`
        return new Error(msg)
      }
      case '28P01':
        return new Error(`Password authentication failed for user "${info.username}".`)
      case '28000':
        return new Error(
          `The server rejected user "${info.username}" for database "${info.database}" (check pg_hba.conf allows this client).`
        )
      case '57P03':
        return new Error('The database server is starting up or shutting down. Try again in a moment.')
      case '53300':
        return new Error('The server has too many connections open.')
      default:
        return err instanceof Error ? err : new Error(String(err))
    }
  }

  private async listDatabases(): Promise<string[]> {
    const { info, password } = this.ctx
    for (const database of ['postgres', 'template1']) {
      const client = new pg.Client({
        host: info.host,
        port: info.port,
        database,
        user: info.username,
        password,
        ssl: info.options.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 8_000
      })
      try {
        await client.connect()
        const res = await client.query<{ datname: string }>(
          'SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname'
        )
        return res.rows.map((r) => r.datname)
      } catch {
        continue
      } finally {
        await client.end().catch(() => {})
      }
    }
    return []
  }

  async close(): Promise<void> {
    await this.pool?.end().catch(() => {})
    this.pool = null
  }

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new Error('Not connected')
    const res = await this.pool.query(sql, params)
    return res.rows as T[]
  }

  async ping(): Promise<string | undefined> {
    const rows = await this.q<{ v: string }>('SELECT version() AS v')
    return rows[0]?.v?.split(' ').slice(0, 2).join(' ')
  }

  async getSchema(): Promise<SchemaInfo> {
    const params: unknown[] = []
    let schemaCond = `table_schema NOT IN ${SYSTEM_SCHEMAS} AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp%'`
    if (this.schemaFilter) {
      schemaCond = 'table_schema = $1'
      params.push(this.schemaFilter)
    }

    const [tables, columns, pks, fks, stats] = await Promise.all([
      this.q<{ table_schema: string; table_name: string; table_type: string }>(
        `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE ${schemaCond}`,
        params
      ),
      this.q<{
        table_schema: string
        table_name: string
        column_name: string
        data_type: string
        udt_name: string
        is_nullable: string
      }>(
        `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns WHERE ${schemaCond}
         ORDER BY table_schema, table_name, ordinal_position`,
        params
      ),
      this.q<{ table_schema: string; table_name: string; column_name: string }>(
        `SELECT kcu.table_schema, kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND ${schemaCond.replace(/table_schema/g, 'tc.table_schema')}`,
        params
      ),
      this.q<{
        conname: string
        from_schema: string
        from_table: string
        from_col: string
        to_schema: string
        to_table: string
        to_col: string
      }>(
        `SELECT con.conname, ns.nspname AS from_schema, cl.relname AS from_table, att.attname AS from_col,
                nsf.nspname AS to_schema, clf.relname AS to_table, attf.attname AS to_col
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = cl.relnamespace
         JOIN pg_class clf ON clf.oid = con.confrelid
         JOIN pg_namespace nsf ON nsf.oid = clf.relnamespace
         CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS k(from_att, to_att)
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.from_att
         JOIN pg_attribute attf ON attf.attrelid = con.confrelid AND attf.attnum = k.to_att
         WHERE con.contype = 'f'`
      ),
      this.getStats()
    ])

    const statMap = new Map(stats.entities.map((e) => [e.entity, e]))
    const pkSet = new Set(pks.map((p) => `${p.table_schema}.${p.table_name}.${p.column_name}`))
    const fieldsByTable = new Map<string, FieldMeta[]>()
    for (const c of columns) {
      const key = this.entityName(c.table_schema, c.table_name)
      const list = fieldsByTable.get(key) ?? []
      list.push({
        name: c.column_name,
        type: c.data_type === 'USER-DEFINED' || c.data_type === 'ARRAY' ? c.udt_name : c.data_type,
        nullable: c.is_nullable === 'YES',
        isPrimary: pkSet.has(`${c.table_schema}.${c.table_name}.${c.column_name}`)
      })
      fieldsByTable.set(key, list)
    }

    const entities: EntityMeta[] = tables.map((t) => {
      const name = this.entityName(t.table_schema, t.table_name)
      const s = statMap.get(name)
      const fields = fieldsByTable.get(name) ?? []
      this.pkCache.set(name, primaryKeyOf(fields))
      return {
        name,
        kind: t.table_type === 'VIEW' ? 'view' : 'table',
        fields,
        rowCount: s?.rowCount ?? null,
        sizeBytes: s?.sizeBytes ?? null,
        indexCount: s?.indexCount ?? null
      }
    })
    entities.sort((a, b) => a.name.localeCompare(b.name))

    const known = new Set(entities.map((e) => e.name))
    const relations: Relation[] = fks
      .map((f) => ({
        id: `${f.conname}:${f.from_col}`,
        from: this.entityName(f.from_schema, f.from_table),
        fromField: f.from_col,
        to: this.entityName(f.to_schema, f.to_table),
        toField: f.to_col,
        confidence: 1
      }))
      .filter((r) => known.has(r.from) && known.has(r.to))

    return { entities, relations, fetchedAt: Date.now() }
  }

  async getStats(): Promise<StatsResult> {
    const params: unknown[] = []
    let cond = `n.nspname NOT IN ${SYSTEM_SCHEMAS} AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'`
    if (this.schemaFilter) {
      cond = 'n.nspname = $1'
      params.push(this.schemaFilter)
    }
    const [rows, size] = await Promise.all([
      this.q<{ nspname: string; relname: string; est: string; size: string; idx: string }>(
        `SELECT n.nspname, c.relname, c.reltuples::bigint AS est,
                pg_total_relation_size(c.oid) AS size,
                (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS idx
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p') AND ${cond}`,
        params
      ),
      this.q<{ s: string }>('SELECT pg_database_size(current_database()) AS s')
    ])

    const entities = await Promise.all(
      rows.map(async (r) => {
        const name = this.entityName(r.nspname, r.relname)
        let rowCount = toNumber(r.est)
        // reltuples is -1 for never-analyzed tables; those are usually small, so count exactly
        if (rowCount === null || rowCount < 0) {
          const c = await this.q<{ n: string }>(`SELECT count(*) AS n FROM ${this.qualified(name)}`).catch(
            () => []
          )
          rowCount = toNumber(c[0]?.n)
        }
        if (rowCount !== null) this.estimates.set(name, rowCount)
        return { entity: name, rowCount, sizeBytes: toNumber(r.size), indexCount: toNumber(r.idx) }
      })
    )
    return { sizeBytes: toNumber(size[0]?.s), entities }
  }

  async fetchRows(entity: string, opts: FetchRowsOptions): Promise<Record<string, unknown>[]> {
    const where = buildWhere(opts.filters, PG_DIALECT, 0)
    const order = orderClause(qi, opts.orderBy ?? this.pkCache.get(entity), opts.orderDir)
    const n = where.params.length
    return this.q(
      `SELECT * FROM ${this.qualified(entity)}${where.sql}${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...where.params, opts.limit, opts.offset]
    )
  }

  async countRows(entity: string, filters?: RowFilter[]): Promise<{ total: number | null; estimate: boolean }> {
    const est = this.estimates.get(entity)
    if (!filters?.length && est !== undefined && est > 500_000) return { total: est, estimate: true }
    const where = buildWhere(filters, PG_DIALECT, 0)
    const r = await this.q<{ n: string }>(`SELECT count(*) AS n FROM ${this.qualified(entity)}${where.sql}`, where.params)
    return { total: toNumber(r[0]?.n), estimate: false }
  }

  async getIndexes(): Promise<IndexInfo[]> {
    const rows = await this.q<{ nspname: string; tbl: string; idx: string; uniq: boolean; cols: string[] }>(
      `SELECT n.nspname, t.relname AS tbl, i.relname AS idx, ix.indisunique AS uniq,
              array_agg(a.attname::text ORDER BY k.ord) AS cols
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS} AND n.nspname NOT LIKE 'pg_toast%'
       GROUP BY n.nspname, t.relname, i.relname, ix.indisunique`
    )
    return rows.map((r) => ({ entity: this.entityName(r.nspname, r.tbl), name: r.idx, columns: r.cols, unique: r.uniq }))
  }

  async runQuery(text: string, opts: { limit: number; readOnly: boolean }): Promise<RawQueryResult> {
    if (!this.pool) throw new Error('Not connected')
    if (opts.readOnly) assertReadOnly(text)
    const client = await this.pool.connect()
    try {
      if (opts.readOnly) await client.query('BEGIN READ ONLY')
      const raw = await client.query(text)
      if (opts.readOnly) await client.query('ROLLBACK')
      const res = Array.isArray(raw) ? raw[raw.length - 1] : raw
      return {
        columns: res.fields?.map((f: { name: string }) => f.name) ?? [],
        rows: (res.rows ?? []).slice(0, opts.limit + 1),
        rowCount: res.rowCount ?? null,
        command: res.command
      }
    } catch (err) {
      if (opts.readOnly) await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  async updateRow(entity: string, key: string, keyValues: unknown[], changes: Record<string, unknown>): Promise<number> {
    const fields = Object.keys(changes)
    if (!fields.length) return 0
    const sets = fields.map((f, i) => `${qi(f)} = $${i + 1}`).join(', ')
    const params = [...fields.map((f) => sqlValue(changes[f])), String(keyValues[0])]
    if (!this.pool) throw new Error('Not connected')
    const res = await this.pool.query(
      `UPDATE ${this.qualified(entity)} SET ${sets} WHERE ${qi(key)} = $${fields.length + 1}`,
      params
    )
    return res.rowCount ?? 0
  }

  async fetchByValues(entity: string, key: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    if (!values.length) return []
    // untyped params let Postgres infer the column type, so the key index is used
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
    return this.q(
      `SELECT * FROM ${this.qualified(entity)} WHERE ${qi(key)} IN (${placeholders})`,
      values.map((v) => String(v))
    )
  }

  async countWhere(entity: string, field: string, value: unknown): Promise<number | null> {
    const r = await this.q<{ n: string }>(
      `SELECT count(*) AS n FROM ${this.qualified(entity)} WHERE ${qi(field)} = $1`,
      [String(value)]
    )
    return toNumber(r[0]?.n)
  }

  coerceKey(_entity: string, _field: string, value: string): unknown[] {
    return [value]
  }
}

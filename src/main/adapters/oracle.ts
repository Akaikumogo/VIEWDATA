import oracledb from 'oracledb'
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
  chunk,
  orderClause,
  primaryKeyOf,
  sqlValue,
  toNumber
} from './types'

oracledb.fetchAsString = [oracledb.CLOB]
oracledb.fetchAsBuffer = [oracledb.BLOB]

function qi(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"'
}

const ORA_DIALECT: SqlDialect = {
  q: qi,
  ph: (i) => `:${i + 1}`,
  contains: (col, p) => `LOWER(TO_CHAR(${col})) LIKE LOWER(${p})`
}

export class OracleAdapter implements DbAdapter {
  private pool: oracledb.Pool | null = null
  private pkCache = new Map<string, string | null>()
  private estimates = new Map<string, number>()

  constructor(private ctx: AdapterContext) {}

  /** Owner to introspect; defaults to the connected user */
  private get owner(): string {
    return (this.ctx.info.options.schema?.trim() || this.ctx.info.username).toUpperCase()
  }

  private table(entity: string): string {
    return `${qi(this.owner)}.${qi(entity)}`
  }

  async connect(): Promise<void> {
    const { info, password } = this.ctx
    const raw = info.database.trim()
    // a full descriptor or EZConnect string typed into the service field is used verbatim
    const connectString =
      raw.startsWith('(') || raw.includes(':') || raw.includes('//')
        ? raw
        : `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${info.host})(PORT=${info.port}))(CONNECT_DATA=(SERVICE_NAME=${raw})))`
    this.pool = await oracledb.createPool({
      user: info.username,
      password,
      connectString,
      poolMin: 0,
      poolMax: 4,
      connectTimeout: 10
    })
    await this.ping()
  }

  async close(): Promise<void> {
    await this.pool?.close(0).catch(() => {})
    this.pool = null
  }

  private async q<T = Record<string, unknown>>(
    sql: string,
    binds: oracledb.BindParameters = []
  ): Promise<T[]> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    try {
      const res = await conn.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })
      return (res.rows ?? []) as T[]
    } finally {
      await conn.close()
    }
  }

  async ping(): Promise<string | undefined> {
    const r = await this.q<{ V: string }>(`SELECT banner AS v FROM v$version WHERE ROWNUM = 1`).catch(() =>
      this.q<{ V: string }>(`SELECT 'Oracle' AS v FROM dual`)
    )
    return r[0]?.V
  }

  async getSchema(): Promise<SchemaInfo> {
    const owner = { owner: this.owner }
    const [tables, views, columns, pks, fks, stats] = await Promise.all([
      this.q<{ TABLE_NAME: string }>(
        `SELECT table_name FROM all_tables WHERE owner = :owner AND nested = 'NO' AND secondary = 'N'`,
        owner
      ),
      this.q<{ VIEW_NAME: string }>(`SELECT view_name FROM all_views WHERE owner = :owner`, owner),
      this.q<{
        TABLE_NAME: string
        COLUMN_NAME: string
        DATA_TYPE: string
        NULLABLE: string
      }>(
        `SELECT table_name, column_name, data_type, nullable FROM all_tab_columns
         WHERE owner = :owner ORDER BY table_name, column_id`,
        owner
      ),
      this.q<{ TABLE_NAME: string; COLUMN_NAME: string }>(
        `SELECT cols.table_name, cols.column_name
         FROM all_constraints cons
         JOIN all_cons_columns cols ON cons.constraint_name = cols.constraint_name AND cons.owner = cols.owner
         WHERE cons.constraint_type = 'P' AND cons.owner = :owner`,
        owner
      ),
      this.q<{
        CONSTRAINT_NAME: string
        TABLE_NAME: string
        COLUMN_NAME: string
        REF_TABLE: string
        REF_COLUMN: string
      }>(
        `SELECT a.constraint_name, a.table_name, a.column_name,
                c_pk.table_name AS ref_table, b.column_name AS ref_column
         FROM all_cons_columns a
         JOIN all_constraints c ON a.owner = c.owner AND a.constraint_name = c.constraint_name
         JOIN all_constraints c_pk ON c.r_owner = c_pk.owner AND c.r_constraint_name = c_pk.constraint_name
         JOIN all_cons_columns b ON b.owner = c_pk.owner AND b.constraint_name = c_pk.constraint_name
                                AND b.position = a.position
         WHERE c.constraint_type = 'R' AND a.owner = :owner`,
        owner
      ),
      this.getStats()
    ])

    const statMap = new Map(stats.entities.map((e) => [e.entity, e]))
    const pkSet = new Set(pks.map((p) => `${p.TABLE_NAME}.${p.COLUMN_NAME}`))
    const fieldsByTable = new Map<string, FieldMeta[]>()
    for (const c of columns) {
      const list = fieldsByTable.get(c.TABLE_NAME) ?? []
      list.push({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.NULLABLE === 'Y',
        isPrimary: pkSet.has(`${c.TABLE_NAME}.${c.COLUMN_NAME}`)
      })
      fieldsByTable.set(c.TABLE_NAME, list)
    }

    const build = (name: string, kind: 'table' | 'view'): EntityMeta => {
      const fields = fieldsByTable.get(name) ?? []
      this.pkCache.set(name, primaryKeyOf(fields))
      const s = statMap.get(name)
      return {
        name,
        kind,
        fields,
        rowCount: s?.rowCount ?? null,
        sizeBytes: s?.sizeBytes ?? null,
        indexCount: s?.indexCount ?? null
      }
    }

    const entities = [
      ...tables.map((t) => build(t.TABLE_NAME, 'table')),
      ...views.map((v) => build(v.VIEW_NAME, 'view'))
    ].sort((a, b) => a.name.localeCompare(b.name))

    const known = new Set(entities.map((e) => e.name))
    const relations: Relation[] = fks
      .filter((f) => known.has(f.REF_TABLE))
      .map((f) => ({
        id: `${f.CONSTRAINT_NAME}:${f.COLUMN_NAME}`,
        from: f.TABLE_NAME,
        fromField: f.COLUMN_NAME,
        to: f.REF_TABLE,
        toField: f.REF_COLUMN,
        confidence: 1
      }))

    return { entities, relations, fetchedAt: Date.now() }
  }

  async getStats(): Promise<StatsResult> {
    const owner = { owner: this.owner }
    const [tables, segs, idx] = await Promise.all([
      this.q<{ TABLE_NAME: string; NUM_ROWS: number | null }>(
        `SELECT table_name, num_rows FROM all_tables WHERE owner = :owner AND nested = 'NO' AND secondary = 'N'`,
        owner
      ),
      // dba_segments needs extra privileges, user_segments only works for the own schema
      this.q<{ SEGMENT_NAME: string; BYTES: number }>(
        `SELECT segment_name, SUM(bytes) AS bytes FROM user_segments
         WHERE segment_type LIKE 'TABLE%' GROUP BY segment_name`
      ).catch(() => []),
      this.q<{ TABLE_NAME: string; N: number }>(
        `SELECT table_name, COUNT(*) AS n FROM all_indexes WHERE table_owner = :owner GROUP BY table_name`,
        owner
      )
    ])
    const sizeMap = new Map(segs.map((s) => [s.SEGMENT_NAME, toNumber(s.BYTES)]))
    const idxMap = new Map(idx.map((i) => [i.TABLE_NAME, toNumber(i.N)]))

    let total = 0
    const entities = await Promise.all(
      tables.map(async (t) => {
        let rowCount = toNumber(t.NUM_ROWS)
        if (rowCount === null) {
          const c = await this.q<{ N: number }>(`SELECT COUNT(*) AS n FROM ${this.table(t.TABLE_NAME)}`).catch(
            () => []
          )
          rowCount = toNumber(c[0]?.N)
        }
        if (rowCount !== null) this.estimates.set(t.TABLE_NAME, rowCount)
        const size = sizeMap.get(t.TABLE_NAME) ?? null
        total += size ?? 0
        return { entity: t.TABLE_NAME, rowCount, sizeBytes: size, indexCount: idxMap.get(t.TABLE_NAME) ?? null }
      })
    )
    return { sizeBytes: segs.length ? total : null, entities }
  }

  async fetchRows(entity: string, opts: FetchRowsOptions): Promise<Record<string, unknown>[]> {
    const where = buildWhere(opts.filters, ORA_DIALECT)
    const order = orderClause(qi, opts.orderBy ?? this.pkCache.get(entity), opts.orderDir)
    const n = where.params.length
    return this.q(
      `SELECT * FROM ${this.table(entity)}${where.sql}${order}
       OFFSET :${n + 1} ROWS FETCH NEXT :${n + 2} ROWS ONLY`,
      [...where.params, opts.offset, opts.limit] as oracledb.BindParameters
    )
  }

  async countRows(entity: string, filters?: RowFilter[]): Promise<{ total: number | null; estimate: boolean }> {
    const est = this.estimates.get(entity)
    if (!filters?.length && est !== undefined && est > 500_000) return { total: est, estimate: true }
    const where = buildWhere(filters, ORA_DIALECT)
    const r = await this.q<{ N: number }>(
      `SELECT COUNT(*) AS n FROM ${this.table(entity)}${where.sql}`,
      where.params as oracledb.BindParameters
    )
    return { total: toNumber(r[0]?.N), estimate: false }
  }

  async getIndexes(): Promise<IndexInfo[]> {
    const rows = await this.q<{ TABLE_NAME: string; INDEX_NAME: string; COLUMN_NAME: string; UNIQUENESS: string }>(
      `SELECT c.table_name, c.index_name, c.column_name, i.uniqueness
       FROM all_ind_columns c
       JOIN all_indexes i ON i.owner = c.index_owner AND i.index_name = c.index_name
       WHERE c.table_owner = :owner ORDER BY c.table_name, c.index_name, c.column_position`,
      { owner: this.owner }
    )
    const map = new Map<string, IndexInfo>()
    for (const r of rows) {
      const id = `${r.TABLE_NAME}.${r.INDEX_NAME}`
      const ix = map.get(id) ?? { entity: r.TABLE_NAME, name: r.INDEX_NAME, columns: [], unique: r.UNIQUENESS === 'UNIQUE' }
      ix.columns.push(r.COLUMN_NAME)
      map.set(id, ix)
    }
    return [...map.values()]
  }

  async runQuery(text: string, opts: { limit: number; readOnly: boolean }): Promise<RawQueryResult> {
    if (!this.pool) throw new Error('Not connected')
    if (opts.readOnly) assertReadOnly(text)
    const sql = text.trim().replace(/;\s*$/, '')
    const conn = await this.pool.getConnection()
    try {
      if (opts.readOnly) await conn.execute('SET TRANSACTION READ ONLY')
      const res = await conn.execute<Record<string, unknown>>(sql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: opts.limit + 1,
        autoCommit: !opts.readOnly
      })
      return {
        columns: res.metaData?.map((m) => m.name) ?? [],
        rows: res.rows ?? [],
        rowCount: res.rows ? res.rows.length : (res.rowsAffected ?? null)
      }
    } finally {
      if (opts.readOnly) await conn.rollback().catch(() => {})
      await conn.close()
    }
  }

  async updateRow(entity: string, key: string, keyValues: unknown[], changes: Record<string, unknown>): Promise<number> {
    const fields = Object.keys(changes)
    if (!fields.length || !this.pool) return 0
    const conn = await this.pool.getConnection()
    try {
      const res = await conn.execute(
        `UPDATE ${this.table(entity)} SET ${fields.map((f, i) => `${qi(f)} = :${i + 1}`).join(', ')}
         WHERE ${qi(key)} = :${fields.length + 1}`,
        [...fields.map((f) => sqlValue(changes[f])), keyValues[0]] as oracledb.BindParameters,
        { autoCommit: true }
      )
      return res.rowsAffected ?? 0
    } finally {
      await conn.close()
    }
  }

  async fetchByValues(entity: string, key: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    // Oracle caps IN lists at 1000 items
    for (const part of chunk(values, 900)) {
      const binds: Record<string, unknown> = {}
      const names = part.map((v, i) => {
        binds[`b${i}`] = typeof v === 'number' ? v : String(v)
        return `:b${i}`
      })
      out.push(
        ...(await this.q(
          `SELECT * FROM ${this.table(entity)} WHERE ${qi(key)} IN (${names.join(', ')})`,
          binds as oracledb.BindParameters
        ))
      )
    }
    return out
  }

  async countWhere(entity: string, field: string, value: unknown): Promise<number | null> {
    const r = await this.q<{ N: number }>(`SELECT COUNT(*) AS n FROM ${this.table(entity)} WHERE ${qi(field)} = :v`, {
      v: typeof value === 'number' ? value : String(value)
    })
    return toNumber(r[0]?.N)
  }

  coerceKey(_entity: string, _field: string, value: string): unknown[] {
    return [value]
  }
}

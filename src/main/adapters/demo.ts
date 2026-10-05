import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import type { EntityMeta, FieldMeta, IndexInfo, Relation, RowFilter, SchemaInfo } from '../../shared/types'
import {
  type DbAdapter,
  type FetchRowsOptions,
  type RawQueryResult,
  type SqlDialect,
  type StatsResult,
  assertReadOnly,
  buildWhere,
  orderClause,
  primaryKeyOf,
  sqlValue
} from './types'

const SCHEMA = `
CREATE TABLE regions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL);
CREATE TABLE warehouses (id INTEGER PRIMARY KEY, name TEXT NOT NULL, region_id INTEGER NOT NULL REFERENCES regions(id), capacity INTEGER);
CREATE TABLE employees (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, title TEXT, manager_id INTEGER REFERENCES employees(id), warehouse_id INTEGER REFERENCES warehouses(id), hired_at TEXT);
CREATE TABLE customers (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, region_id INTEGER REFERENCES regions(id), account_manager_id INTEGER REFERENCES employees(id), created_at TEXT);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES categories(id));
CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT, rating REAL);
CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL, name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), supplier_id INTEGER REFERENCES suppliers(id), price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE inventory (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), quantity INTEGER NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, number TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id), handled_by INTEGER REFERENCES employees(id), status TEXT NOT NULL, placed_at TEXT NOT NULL, total_cents INTEGER NOT NULL);
CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_cents INTEGER NOT NULL);
CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), method TEXT NOT NULL, amount_cents INTEGER NOT NULL, paid_at TEXT);
CREATE TABLE shipments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), carrier TEXT, tracking_code TEXT, shipped_at TEXT);
CREATE TABLE reviews (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), customer_id INTEGER NOT NULL REFERENCES customers(id), stars INTEGER NOT NULL, body TEXT);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, created_at TEXT);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);
`

const FIRST = ['Dilnoza', 'Timur', 'Malika', 'Rustam', 'Kamola', 'Bekzod', 'Nilufar', 'Jasur', 'Sevara', 'Otabek', 'Madina', 'Sardor', 'Lola', 'Aziz', 'Zarina', 'Farrukh', 'Gulnora', 'Ilhom', 'Shahnoza', 'Javohir']
const LAST = ['Karimova', 'Yusupov', 'Rahimova', 'Tursunov', 'Saidova', 'Ergashev', 'Nazarova', 'Qodirov', 'Aliyeva', 'Mirzayev', 'Xolmatova', 'Sobirov']
const REGIONS = [
  ['Tashkent', 'TAS'],
  ['Samarkand', 'SKD'],
  ['Bukhara', 'BHK'],
  ['Fergana', 'FEG'],
  ['Namangan', 'NMA'],
  ['Khorezm', 'URG']
]
const CATS = ['Hardware', 'Fasteners', 'Power tools', 'Hand tools', 'Lighting', 'Cables', 'Safety gear', 'Adhesives', 'Plumbing', 'Paint']
const NOUNS = ['Drill', 'Clamp', 'Wrench', 'Lamp', 'Bracket', 'Sealant', 'Glove set', 'Cable reel', 'Valve', 'Primer', 'Hinge', 'Saw blade', 'Level', 'Torch']
const ADJ = ['Compact', 'Heavy-duty', 'Brushed', 'Insulated', 'Matte', 'Industrial', 'Low-profile', 'Marine-grade']

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seed(db: Database): void {
  const r = rng(4127)
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]
  const int = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1))
  const day = (back: number): string => new Date(Date.UTC(2026, 8, 30) - int(0, back) * 86_400_000).toISOString()
  const person = (): string => `${pick(FIRST)} ${pick(LAST)}`

  db.exec('BEGIN')
  REGIONS.forEach(([n, c], i) => db.run('INSERT INTO regions VALUES (?, ?, ?)', [i + 1, n, c]))
  for (let i = 1; i <= 9; i++) {
    db.run('INSERT INTO warehouses VALUES (?, ?, ?, ?)', [i, `Depot ${String.fromCharCode(64 + i)}-${int(10, 99)}`, int(1, REGIONS.length), int(800, 14000)])
  }
  for (let i = 1; i <= 48; i++) {
    db.run('INSERT INTO employees VALUES (?, ?, ?, ?, ?, ?)', [
      i,
      person(),
      i <= 4 ? 'Regional lead' : pick(['Picker', 'Account manager', 'Dispatcher', 'Analyst', 'Buyer']),
      i <= 4 ? null : int(1, 4),
      int(1, 9),
      day(1800)
    ])
  }
  for (let i = 1; i <= 420; i++) {
    const name = person()
    db.run('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?)', [
      i,
      name,
      `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${int(2, 97)}@mailbox.uz`,
      `+998 ${int(90, 99)} ${int(100, 999)}-${int(10, 99)}-${int(10, 99)}`,
      int(1, REGIONS.length),
      int(5, 48),
      day(900)
    ])
  }
  CATS.forEach((c, i) => db.run('INSERT INTO categories VALUES (?, ?, ?)', [i + 1, c, i >= 6 ? int(1, 5) : null]))
  for (let i = 1; i <= 24; i++) {
    db.run('INSERT INTO suppliers VALUES (?, ?, ?, ?)', [i, `${pick(LAST)} ${pick(['Metalworks', 'Trading', 'Supply Co.', 'Industries'])}`, pick(['UZ', 'KZ', 'TR', 'DE', 'CN', 'KR']), Math.round((2.4 + r() * 2.6) * 10) / 10])
  }
  for (let i = 1; i <= 160; i++) {
    db.run('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?)', [
      i,
      `KS-${int(1000, 9999)}-${String.fromCharCode(65 + int(0, 25))}`,
      `${pick(ADJ)} ${pick(NOUNS)}`,
      int(1, CATS.length),
      int(1, 24),
      int(190, 48900),
      r() > 0.08 ? 1 : 0
    ])
  }
  let inv = 1
  for (let p = 1; p <= 160; p++) {
    for (let k = 0; k < int(1, 3); k++) db.run('INSERT INTO inventory VALUES (?, ?, ?, ?)', [inv++, p, int(1, 9), int(0, 640)])
  }
  let item = 1
  let pay = 1
  let ship = 1
  for (let o = 1; o <= 1400; o++) {
    const status = pick(['delivered', 'delivered', 'delivered', 'shipped', 'paid', 'pending', 'cancelled'])
    const placed = day(540)
    let total = 0
    const lines = int(1, 5)
    for (let l = 0; l < lines; l++) {
      const qty = int(1, 12)
      const unit = int(190, 48900)
      total += qty * unit
      db.run('INSERT INTO order_items VALUES (?, ?, ?, ?, ?)', [item++, o, int(1, 160), qty, unit])
    }
    db.run('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)', [o, `SO-${26000 + o * 7}`, int(1, 420), int(5, 48), status, placed, total])
    if (status !== 'pending' && status !== 'cancelled') {
      db.run('INSERT INTO payments VALUES (?, ?, ?, ?, ?)', [pay++, o, pick(['card', 'card', 'transfer', 'cash']), total, placed])
    }
    if (status === 'shipped' || status === 'delivered') {
      db.run('INSERT INTO shipments VALUES (?, ?, ?, ?, ?, ?)', [ship++, o, int(1, 9), pick(['UzPost', 'Fargo', 'DHL', 'Yandex Delivery']), `TRK${int(10000000, 99999999)}`, placed])
    }
  }
  for (let i = 1; i <= 620; i++) {
    db.run('INSERT INTO reviews VALUES (?, ?, ?, ?, ?)', [i, int(1, 160), int(1, 420), int(2, 5), pick(['Solid build, arrived early.', 'Works as described.', 'Packaging was damaged but item is fine.', 'Would order again.', 'Smaller than expected.'])])
  }
  for (let i = 1; i <= 90; i++) db.run('INSERT INTO audit_log VALUES (?, ?, ?, ?)', [i, person(), pick(['login', 'export', 'price_update', 'refund']), day(60)])
  db.exec('COMMIT')
}

let cached: Database | null = null

async function demoDb(): Promise<Database> {
  if (cached) return cached
  const SQL = await initSqlJs({ locateFile: (f) => join(dirname(require.resolve('sql.js')), f) })
  const db = new SQL.Database()
  db.exec(SCHEMA)
  seed(db)
  cached = db
  return db
}

function qi(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"'
}

const LITE_DIALECT: SqlDialect = {
  q: qi,
  ph: () => '?',
  contains: (col, p) => `CAST(${col} AS TEXT) LIKE ${p}`
}

export class DemoAdapter implements DbAdapter {
  private db: Database | null = null
  private pkCache = new Map<string, string | null>()

  async connect(): Promise<void> {
    this.db = await demoDb()
  }

  async close(): Promise<void> {
    this.db = null
  }

  private all(sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
    if (!this.db) throw new Error('Not connected')
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const out: Record<string, unknown>[] = []
      while (stmt.step()) out.push(stmt.getAsObject())
      return out
    } finally {
      stmt.free()
    }
  }

  async ping(): Promise<string | undefined> {
    return `SQLite ${this.all('SELECT sqlite_version() AS v')[0]?.v}`
  }

  private tables(): string[] {
    return this.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map(
      (r) => String(r.name)
    )
  }

  async getSchema(): Promise<SchemaInfo> {
    const stats = await this.getStats()
    const statMap = new Map(stats.entities.map((e) => [e.entity, e]))
    const entities: EntityMeta[] = []
    const relations: Relation[] = []
    for (const t of this.tables()) {
      const fields: FieldMeta[] = this.all(`PRAGMA table_info(${qi(t)})`).map((c) => ({
        name: String(c.name),
        type: String(c.type || 'ANY').toLowerCase(),
        nullable: !c.notnull && !c.pk,
        isPrimary: Number(c.pk) > 0
      }))
      this.pkCache.set(t, primaryKeyOf(fields))
      const s = statMap.get(t)
      entities.push({ name: t, kind: 'table', fields, rowCount: s?.rowCount ?? null, sizeBytes: s?.sizeBytes ?? null, indexCount: s?.indexCount ?? null })
      for (const fk of this.all(`PRAGMA foreign_key_list(${qi(t)})`)) {
        relations.push({
          id: `${t}.${fk.from}->${fk.table}`,
          from: t,
          fromField: String(fk.from),
          to: String(fk.table),
          toField: String(fk.to ?? 'id'),
          confidence: 1
        })
      }
    }
    return { entities, relations, fetchedAt: Date.now() }
  }

  async getStats(): Promise<StatsResult> {
    let total = 0
    const entities = this.tables().map((t) => {
      const rows = Number(this.all(`SELECT COUNT(*) AS n FROM ${qi(t)}`)[0]?.n ?? 0)
      const cols = this.all(`PRAGMA table_info(${qi(t)})`).length
      const idx = this.all(`PRAGMA index_list(${qi(t)})`).length
      // sql.js has no dbstat; approximate on-disk size from row and column count
      const size = Math.max(4096, rows * cols * 14)
      total += size
      return { entity: t, rowCount: rows, sizeBytes: size, indexCount: idx }
    })
    return { sizeBytes: total, entities }
  }

  async fetchRows(entity: string, opts: FetchRowsOptions): Promise<Record<string, unknown>[]> {
    const where = buildWhere(opts.filters, LITE_DIALECT)
    const order = orderClause(qi, opts.orderBy ?? this.pkCache.get(entity), opts.orderDir)
    return this.all(`SELECT * FROM ${qi(entity)}${where.sql}${order} LIMIT ? OFFSET ?`, [
      ...(where.params as SqlValue[]),
      opts.limit,
      opts.offset
    ])
  }

  async countRows(entity: string, filters?: RowFilter[]): Promise<{ total: number | null; estimate: boolean }> {
    const where = buildWhere(filters, LITE_DIALECT)
    return {
      total: Number(this.all(`SELECT COUNT(*) AS n FROM ${qi(entity)}${where.sql}`, where.params as SqlValue[])[0]?.n ?? 0),
      estimate: false
    }
  }

  async getIndexes(): Promise<IndexInfo[]> {
    const out: IndexInfo[] = []
    for (const t of this.tables()) {
      for (const ix of this.all(`PRAGMA index_list(${qi(t)})`)) {
        const name = String(ix.name)
        const columns = this.all(`PRAGMA index_info(${qi(name)})`).map((c) => String(c.name))
        out.push({ entity: t, name, columns, unique: Number(ix.unique) === 1 })
      }
    }
    return out
  }

  async runQuery(text: string, opts: { limit: number; readOnly: boolean }): Promise<RawQueryResult> {
    if (!this.db) throw new Error('Not connected')
    if (opts.readOnly) assertReadOnly(text)
    // sqlite's changes() keeps the count of the last DML statement, so diff total_changes() instead
    const before = Number(this.all('SELECT total_changes() AS n')[0]?.n ?? 0)
    const results = this.db.exec(text)
    const last = results[results.length - 1]
    if (!last) {
      return { columns: [], rows: [], rowCount: Number(this.all('SELECT total_changes() AS n')[0]?.n ?? 0) - before }
    }
    const rows = last.values.slice(0, opts.limit + 1).map((vals) => {
      const row: Record<string, unknown> = {}
      last.columns.forEach((c, i) => (row[c] = vals[i]))
      return row
    })
    return { columns: last.columns, rows, rowCount: last.values.length }
  }

  async updateRow(entity: string, key: string, keyValues: unknown[], changes: Record<string, unknown>): Promise<number> {
    const fields = Object.keys(changes)
    if (!fields.length || !this.db) return 0
    this.db.run(`UPDATE ${qi(entity)} SET ${fields.map((f) => `${qi(f)} = ?`).join(', ')} WHERE ${qi(key)} = ?`, [
      ...fields.map((f) => sqlValue(changes[f]) as SqlValue),
      keyValues[0] as SqlValue
    ])
    return this.db.getRowsModified()
  }

  async fetchByValues(entity: string, key: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    if (!values.length) return []
    return this.all(
      `SELECT * FROM ${qi(entity)} WHERE ${qi(key)} IN (${values.map(() => '?').join(', ')})`,
      values.map((v) => (typeof v === 'number' ? v : String(v)))
    )
  }

  async countWhere(entity: string, field: string, value: unknown): Promise<number | null> {
    return Number(
      this.all(`SELECT COUNT(*) AS n FROM ${qi(entity)} WHERE ${qi(field)} = ?`, [
        typeof value === 'number' ? value : String(value)
      ])[0]?.n ?? 0
    )
  }

  coerceKey(_entity: string, _field: string, value: string): unknown[] {
    return /^-?\d+$/.test(value) ? [Number(value)] : [value]
  }
}

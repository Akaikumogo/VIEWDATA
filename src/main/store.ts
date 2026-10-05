import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import type {
  AlertEvent,
  AlertKind,
  AlertRule,
  ConnectionInfo,
  ConnectionInput,
  EntityPoint,
  EntityStat,
  NodePositions,
  QueryHistoryItem,
  SchemaInfo,
  Snapshot
} from '../shared/types'

let db: Database
let dbPath = ''
let saveTimer: NodeJS.Timeout | null = null

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 0,
  database TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  secret TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  size_bytes INTEGER,
  entity_count INTEGER,
  row_count INTEGER,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_conn ON snapshots(connection_id, taken_at);
CREATE TABLE IF NOT EXISTS entity_stats (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  row_count INTEGER,
  size_bytes INTEGER,
  index_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entity_stats_snap ON entity_stats(snapshot_id);
CREATE TABLE IF NOT EXISTS schema_cache (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS display_fields (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  field TEXT NOT NULL,
  PRIMARY KEY (connection_id, entity)
);
CREATE TABLE IF NOT EXISTS layout_cache (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  duration_ms INTEGER,
  ok INTEGER NOT NULL,
  error TEXT,
  row_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_query_history_conn ON query_history(connection_id, ran_at);
CREATE TABLE IF NOT EXISTS schema_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schema_history_conn ON schema_history(connection_id, taken_at);
CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  threshold REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  fired_at INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_events_conn ON alert_events(connection_id, fired_at);
`

function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name)
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

export async function initStore(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file) => join(dirname(require.resolve('sql.js')), file)
  })
  dbPath = join(app.getPath('userData'), 'viewdata.sqlite')
  mkdirSync(dirname(dbPath), { recursive: true })
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(MIGRATIONS)
  addColumnIfMissing('connections', 'ssh_secret', 'ssh_secret TEXT')
  pruneHistory()
  flush()
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 400)
}

export function flush(): void {
  if (!db) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const tmp = dbPath + '.tmp'
  writeFileSync(tmp, Buffer.from(db.export()))
  renameSync(tmp, dbPath)
}

function all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const out: T[] = []
    while (stmt.step()) out.push(stmt.getAsObject() as T)
    return out
  } finally {
    stmt.free()
  }
}

function get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | undefined {
  return all<T>(sql, params)[0]
}

function run(sql: string, params: SqlValue[] = []): void {
  db.run(sql, params)
  scheduleSave()
}

/* ---------- connections ---------- */

interface ConnectionRow {
  id: string
  name: string
  kind: string
  host: string
  port: number
  database: string
  username: string
  secret: string | null
  ssh_secret: string | null
  options_json: string
  created_at: number
}

function toInfo(r: ConnectionRow): ConnectionInfo {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ConnectionInfo['kind'],
    host: r.host,
    port: r.port,
    database: r.database,
    username: r.username,
    options: JSON.parse(r.options_json || '{}'),
    createdAt: r.created_at
  }
}

export function listConnections(): ConnectionInfo[] {
  return all<ConnectionRow>('SELECT * FROM connections ORDER BY created_at').map(toInfo)
}

export function getConnection(
  id: string
): { info: ConnectionInfo; secret: string | null; sshSecret: string | null } | null {
  const r = get<ConnectionRow>('SELECT * FROM connections WHERE id = ?', [id])
  return r ? { info: toInfo(r), secret: r.secret, sshSecret: r.ssh_secret } : null
}

export function insertConnection(
  id: string,
  input: ConnectionInput,
  secret: string | null,
  sshSecret: string | null = null
): void {
  run(
    `INSERT INTO connections (id, name, kind, host, port, database, username, secret, ssh_secret, options_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.kind,
      input.host,
      input.port,
      input.database,
      input.username,
      secret,
      sshSecret,
      JSON.stringify(input.options ?? {}),
      Date.now()
    ]
  )
}

export function updateConnection(
  id: string,
  input: ConnectionInput,
  secret: string | null | undefined,
  sshSecret: string | null | undefined = undefined
): void {
  const params: SqlValue[] = [
    input.name,
    input.kind,
    input.host,
    input.port,
    input.database,
    input.username,
    JSON.stringify(input.options ?? {})
  ]
  let sql = `UPDATE connections SET name = ?, kind = ?, host = ?, port = ?, database = ?, username = ?, options_json = ?`
  if (secret !== undefined) {
    sql += ', secret = ?'
    params.push(secret)
  }
  if (sshSecret !== undefined) {
    sql += ', ssh_secret = ?'
    params.push(sshSecret)
  }
  params.push(id)
  run(sql + ' WHERE id = ?', params)
  run('DELETE FROM schema_cache WHERE connection_id = ?', [id])
}

export function deleteConnection(id: string): void {
  run('DELETE FROM connections WHERE id = ?', [id])
}

/* ---------- snapshots ---------- */

interface SnapshotRow {
  id: number
  connection_id: string
  taken_at: number
  status: string
  error: string | null
  size_bytes: number | null
  entity_count: number | null
  row_count: number | null
  latency_ms: number | null
}

function toSnapshot(r: SnapshotRow): Snapshot {
  return {
    connectionId: r.connection_id,
    takenAt: r.taken_at,
    status: r.status as Snapshot['status'],
    error: r.error ?? undefined,
    sizeBytes: r.size_bytes,
    entityCount: r.entity_count,
    rowCount: r.row_count,
    latencyMs: r.latency_ms
  }
}

export function insertSnapshot(s: Snapshot, stats: EntityStat[]): void {
  db.run(
    `INSERT INTO snapshots (connection_id, taken_at, status, error, size_bytes, entity_count, row_count, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.connectionId, s.takenAt, s.status, s.error ?? null, s.sizeBytes, s.entityCount, s.rowCount, s.latencyMs]
  )
  const snapId = get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  for (const e of stats) {
    db.run(
      'INSERT INTO entity_stats (snapshot_id, entity, row_count, size_bytes, index_count) VALUES (?, ?, ?, ?, ?)',
      [snapId, e.entity, e.rowCount, e.sizeBytes, e.indexCount]
    )
  }
  scheduleSave()
}

export function latestSnapshot(connectionId: string): Snapshot | undefined {
  const r = get<SnapshotRow>(
    'SELECT * FROM snapshots WHERE connection_id = ? ORDER BY taken_at DESC LIMIT 1',
    [connectionId]
  )
  return r ? toSnapshot(r) : undefined
}

export function snapshotHistory(connectionId: string | null, sinceMs: number): Snapshot[] {
  const rows = connectionId
    ? all<SnapshotRow>(
        'SELECT * FROM snapshots WHERE connection_id = ? AND taken_at >= ? ORDER BY taken_at',
        [connectionId, sinceMs]
      )
    : all<SnapshotRow>('SELECT * FROM snapshots WHERE taken_at >= ? ORDER BY taken_at', [sinceMs])
  return rows.map(toSnapshot)
}

/** Entity stats from the most recent successful snapshot of a connection */
export function latestEntityStats(connectionId: string): EntityStat[] {
  const snap = get<{ id: number }>(
    `SELECT id FROM snapshots WHERE connection_id = ? AND status = 'ok' ORDER BY taken_at DESC LIMIT 1`,
    [connectionId]
  )
  if (!snap) return []
  return all<{ entity: string; row_count: number | null; size_bytes: number | null; index_count: number | null }>(
    'SELECT * FROM entity_stats WHERE snapshot_id = ?',
    [snap.id]
  ).map((r) => ({
    entity: r.entity,
    rowCount: r.row_count,
    sizeBytes: r.size_bytes,
    indexCount: r.index_count
  }))
}

/** Per-entity row/size points over time, oldest first */
export function entityHistory(connectionId: string, sinceMs: number): Record<string, EntityPoint[]> {
  const out: Record<string, EntityPoint[]> = {}
  for (const r of all<{ entity: string; t: number; rows: number | null; size: number | null }>(
    `SELECT e.entity, s.taken_at AS t, e.row_count AS rows, e.size_bytes AS size
     FROM entity_stats e JOIN snapshots s ON s.id = e.snapshot_id
     WHERE s.connection_id = ? AND s.taken_at >= ? AND s.status = 'ok'
     ORDER BY s.taken_at`,
    [connectionId, sinceMs]
  )) {
    ;(out[r.entity] ??= []).push({ t: r.t, rows: r.rows, size: r.size })
  }
  return out
}

export function pruneHistory(): void {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 90
  const dense = Date.now() - 1000 * 60 * 60 * 48
  db.run('DELETE FROM snapshots WHERE taken_at < ?', [cutoff])
  // live mode snapshots often; past 48h keep one snapshot per connection per hour
  db.run(
    `DELETE FROM snapshots WHERE taken_at < ? AND id NOT IN (
       SELECT MIN(id) FROM snapshots WHERE taken_at < ? GROUP BY connection_id, taken_at / 3600000
     )`,
    [dense, dense]
  )
  db.run('DELETE FROM query_history WHERE ran_at < ?', [cutoff])
  db.run('DELETE FROM alert_events WHERE fired_at < ?', [cutoff])
}

/* ---------- query history ---------- */

export function addQueryHistory(connectionId: string, item: Omit<QueryHistoryItem, 'id'>): void {
  run(
    `INSERT INTO query_history (connection_id, text, ran_at, duration_ms, ok, error, row_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [connectionId, item.text, item.ranAt, item.durationMs, item.ok ? 1 : 0, item.error ?? null, item.rowCount]
  )
  // keep the newest 200 per connection
  run(
    `DELETE FROM query_history WHERE connection_id = ? AND id NOT IN
     (SELECT id FROM query_history WHERE connection_id = ? ORDER BY ran_at DESC LIMIT 200)`,
    [connectionId, connectionId]
  )
}

export function listQueryHistory(connectionId: string): QueryHistoryItem[] {
  return all<{
    id: number
    text: string
    ran_at: number
    duration_ms: number | null
    ok: number
    error: string | null
    row_count: number | null
  }>('SELECT * FROM query_history WHERE connection_id = ? ORDER BY ran_at DESC LIMIT 200', [connectionId]).map(
    (r) => ({
      id: r.id,
      text: r.text,
      ranAt: r.ran_at,
      durationMs: r.duration_ms,
      ok: r.ok === 1,
      error: r.error ?? undefined,
      rowCount: r.row_count
    })
  )
}

export function clearQueryHistory(connectionId: string): void {
  run('DELETE FROM query_history WHERE connection_id = ?', [connectionId])
}

/* ---------- schema history ---------- */

export function lastSchemaSignature(connectionId: string): string | null {
  return (
    get<{ json: string }>(
      'SELECT json FROM schema_history WHERE connection_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1',
      [connectionId]
    )?.json ?? null
  )
}

export function addSchemaSignature(connectionId: string, json: string): void {
  run('INSERT INTO schema_history (connection_id, taken_at, json) VALUES (?, ?, ?)', [connectionId, Date.now(), json])
}

export function listSchemaSignatures(connectionId: string): { takenAt: number; json: string }[] {
  return all<{ taken_at: number; json: string }>(
    'SELECT taken_at, json FROM schema_history WHERE connection_id = ? ORDER BY taken_at, id',
    [connectionId]
  ).map((r) => ({ takenAt: r.taken_at, json: r.json }))
}

/* ---------- alerts ---------- */

export function listAlertRules(connectionId?: string): AlertRule[] {
  const rows = connectionId
    ? all<Record<string, SqlValue>>('SELECT * FROM alert_rules WHERE connection_id = ? ORDER BY id', [connectionId])
    : all<Record<string, SqlValue>>('SELECT * FROM alert_rules ORDER BY id')
  return rows.map((r) => ({
    id: Number(r.id),
    connectionId: String(r.connection_id),
    kind: String(r.kind) as AlertKind,
    threshold: Number(r.threshold),
    createdAt: Number(r.created_at)
  }))
}

export function addAlertRule(connectionId: string, kind: AlertKind, threshold: number): void {
  run('INSERT INTO alert_rules (connection_id, kind, threshold, created_at) VALUES (?, ?, ?, ?)', [
    connectionId,
    kind,
    threshold,
    Date.now()
  ])
}

export function deleteAlertRule(id: number): void {
  run('DELETE FROM alert_rules WHERE id = ?', [id])
}

export function addAlertEvent(connectionId: string, ruleId: number, message: string): void {
  run('INSERT INTO alert_events (connection_id, rule_id, fired_at, message) VALUES (?, ?, ?, ?)', [
    connectionId,
    ruleId,
    Date.now(),
    message
  ])
}

export function lastAlertEvent(ruleId: number): number | null {
  return get<{ t: number }>('SELECT MAX(fired_at) AS t FROM alert_events WHERE rule_id = ?', [ruleId])?.t ?? null
}

export function listAlertEvents(connectionId: string): AlertEvent[] {
  return all<Record<string, SqlValue>>(
    'SELECT * FROM alert_events WHERE connection_id = ? ORDER BY fired_at DESC LIMIT 50',
    [connectionId]
  ).map((r) => ({
    id: Number(r.id),
    connectionId: String(r.connection_id),
    ruleId: Number(r.rule_id),
    firedAt: Number(r.fired_at),
    message: String(r.message)
  }))
}

/** Snapshot closest to (but not after) a given time, for growth comparisons */
export function snapshotBefore(connectionId: string, beforeMs: number): Snapshot | undefined {
  const r = get<SnapshotRow>(
    `SELECT * FROM snapshots WHERE connection_id = ? AND status = 'ok' AND taken_at <= ?
     ORDER BY taken_at DESC LIMIT 1`,
    [connectionId, beforeMs]
  )
  return r ? toSnapshot(r) : undefined
}

/* ---------- schema / display / layout caches ---------- */

export function getCachedSchema(connectionId: string): SchemaInfo | null {
  const r = get<{ json: string }>('SELECT json FROM schema_cache WHERE connection_id = ?', [connectionId])
  return r ? (JSON.parse(r.json) as SchemaInfo) : null
}

export function setCachedSchema(connectionId: string, schema: SchemaInfo): void {
  run(
    `INSERT INTO schema_cache (connection_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [connectionId, JSON.stringify(schema), Date.now()]
  )
}

export function getDisplayFields(connectionId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of all<{ entity: string; field: string }>(
    'SELECT entity, field FROM display_fields WHERE connection_id = ?',
    [connectionId]
  )) {
    out[r.entity] = r.field
  }
  return out
}

export function setDisplayField(connectionId: string, entity: string, field: string): void {
  run(
    `INSERT INTO display_fields (connection_id, entity, field) VALUES (?, ?, ?)
     ON CONFLICT(connection_id, entity) DO UPDATE SET field = excluded.field`,
    [connectionId, entity, field]
  )
}

export function getLayout(connectionId: string): NodePositions | null {
  const r = get<{ json: string }>('SELECT json FROM layout_cache WHERE connection_id = ?', [connectionId])
  return r ? (JSON.parse(r.json) as NodePositions) : null
}

export function setLayout(connectionId: string, positions: NodePositions | null): void {
  if (!positions) {
    run('DELETE FROM layout_cache WHERE connection_id = ?', [connectionId])
    return
  }
  run(
    `INSERT INTO layout_cache (connection_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [connectionId, JSON.stringify(positions), Date.now()]
  )
}

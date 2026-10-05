export type DbKind = 'postgres' | 'mysql' | 'mariadb' | 'oracle' | 'mongodb' | 'demo'

export const KIND_LABEL: Record<DbKind, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  oracle: 'Oracle',
  mongodb: 'MongoDB',
  demo: 'Demo (SQLite)'
}

export const KIND_SHORT: Record<DbKind, string> = {
  postgres: 'PG',
  mysql: 'MY',
  mariadb: 'MA',
  oracle: 'OR',
  mongodb: 'MG',
  demo: 'SQ'
}

export const DEFAULT_PORT: Record<DbKind, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  oracle: 1521,
  mongodb: 27017,
  demo: 0
}

export interface SshOptions {
  enabled: boolean
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  privateKeyPath?: string
}

export interface ConnectionOptions {
  ssl?: boolean
  /** MongoDB connection string; overrides host/port/user when set */
  uri?: string
  /** Postgres schema filter / Oracle owner; empty = all user schemas */
  schema?: string
  /** Row editing and write queries are blocked unless this is set */
  allowWrites?: boolean
  ssh?: SshOptions
}

export interface ConnectionInput {
  name: string
  kind: DbKind
  host: string
  port: number
  database: string
  username: string
  /** undefined on update = keep the stored password */
  password?: string
  /** SSH password or key passphrase; undefined on update = keep the stored one */
  sshSecret?: string
  options: ConnectionOptions
}

export type FilterOp = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'null' | 'notnull'

export const FILTER_LABEL: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  contains: 'contains',
  gt: '>',
  lt: '<',
  null: 'is null',
  notnull: 'is not null'
}

export interface RowFilter {
  field: string
  op: FilterOp
  value?: string
}

export interface RowsQuery {
  limit: number
  offset: number
  orderBy?: string | null
  orderDir?: 'asc' | 'desc'
  filters?: RowFilter[]
}

export function writesAllowed(c: { kind: DbKind; options: ConnectionOptions }): boolean {
  return c.kind === 'demo' || !!c.options.allowWrites
}

export interface ConnectionInfo {
  id: string
  name: string
  kind: DbKind
  host: string
  port: number
  database: string
  username: string
  options: ConnectionOptions
  createdAt: number
}

export interface FieldMeta {
  name: string
  type: string
  nullable: boolean
  isPrimary: boolean
  /** MongoDB only: share of sampled documents that contain the field (0..1) */
  frequency?: number
}

export interface EntityMeta {
  name: string
  kind: 'table' | 'view' | 'collection'
  fields: FieldMeta[]
  rowCount: number | null
  sizeBytes: number | null
  indexCount: number | null
}

export interface Relation {
  id: string
  from: string
  fromField: string
  to: string
  toField: string
  /** 1 for declared foreign keys, < 1 for inferred (MongoDB) */
  confidence: number
}

export interface SchemaInfo {
  entities: EntityMeta[]
  relations: Relation[]
  fetchedAt: number
}

export interface EntityStat {
  entity: string
  rowCount: number | null
  sizeBytes: number | null
  indexCount: number | null
}

export interface Snapshot {
  connectionId: string
  takenAt: number
  status: 'ok' | 'error'
  error?: string
  sizeBytes: number | null
  entityCount: number | null
  rowCount: number | null
  latencyMs: number | null
}

export interface TopEntity extends EntityStat {
  connectionId: string
  connectionName: string
  kind: DbKind
}

export interface Overview {
  connections: ConnectionInfo[]
  latest: Record<string, Snapshot | undefined>
  history: Snapshot[]
  topEntities: TopEntity[]
}

export interface EntityPoint {
  t: number
  rows: number | null
  size: number | null
}

export interface ConnectionDetail {
  connection: ConnectionInfo
  latest?: Snapshot
  history: Snapshot[]
  entityStats: EntityStat[]
  entityHistory: Record<string, EntityPoint[]>
}

export interface QueryResult {
  columns: string[]
  rows: Row[]
  rowCount: number | null
  command?: string
  durationMs: number
  truncated: boolean
}

export interface QueryHistoryItem {
  id: number
  text: string
  ranAt: number
  durationMs: number | null
  ok: boolean
  error?: string
  rowCount: number | null
}

export interface IndexInfo {
  entity: string
  name: string
  columns: string[]
  unique: boolean
}

export interface HealthReport {
  missingFkIndexes: { relation: Relation; suggestion: string | null }[]
  tablesWithoutPk: string[]
  indexCount: number
  checkedAt: number
}

export interface ColumnProfile {
  field: string
  nullPct: number
  distinct: number
  top: { value: string; count: number }[]
}

export interface ProfileResult {
  entity: string
  sampled: number
  columns: ColumnProfile[]
  orphans: { relation: Relation; checked: number; missing: number; examples: string[] }[]
}

export interface FieldChange {
  entity: string
  added: string[]
  removed: string[]
  changed: { field: string; from: string; to: string }[]
}

export interface SchemaChange {
  takenAt: number
  baseline: boolean
  entitiesAdded: string[]
  entitiesRemoved: string[]
  fieldChanges: FieldChange[]
  relationsAdded: string[]
  relationsRemoved: string[]
}

export type AlertKind = 'size_gt' | 'offline' | 'growth_pct'

export interface AlertRule {
  id: number
  connectionId: string
  kind: AlertKind
  threshold: number
  createdAt: number
}

export interface AlertEvent {
  id: number
  connectionId: string
  ruleId: number
  firedAt: number
  message: string
}

export type ExportFormat = 'csv' | 'json'
export type SchemaExportFormat = 'dbml' | 'mermaid' | 'json'

export type CellValue =
  | null
  | string
  | number
  | boolean
  | CellValue[]
  | { [key: string]: CellValue }

export type Row = Record<string, CellValue>

export interface FkColumn {
  field: string
  relation: Relation
  displayField: string | null
  labels: Record<string, string>
}

export interface RowsResult {
  rows: Row[]
  total: number | null
  totalIsEstimate: boolean
  fields: FieldMeta[]
  fkColumns: FkColumn[]
}

export interface RecordDetail {
  entity: string
  key: string
  value: string
  row: Row | null
  displayField: string | null
  fields: FieldMeta[]
  outgoing: { relation: Relation; value: string; label: string | null }[]
  incoming: { relation: Relation; count: number | null }[]
}

export interface TestResult {
  ok: boolean
  latencyMs?: number
  error?: string
  serverVersion?: string
}

export type NodePositions = Record<string, { x: number; y: number }>

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

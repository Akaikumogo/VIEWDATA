import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type {
  AlertKind,
  CellValue,
  ConnectionInput,
  ExportFormat,
  IpcResult,
  NodePositions,
  RowFilter,
  RowsQuery,
  SchemaExportFormat,
  TestResult
} from '../shared/types'
import { connectAdapter, dropAdapter } from './adapters'
import { snapshotAll, takeSnapshot } from './analytics'
import * as exporter from './exporter'
import * as insights from './insights'
import { decryptSecret, encryptSecret } from './secrets'
import * as services from './services'
import * as store from './store'

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<IpcResult<Awaited<R>>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Like handle, but the first argument is the window that sent the request (for native dialogs) */
function handleWin<A extends unknown[], R>(
  channel: string,
  fn: (win: BrowserWindow | null, ...args: A) => R | Promise<R>
): void {
  ipcMain.handle(channel, async (e, ...args: unknown[]): Promise<IpcResult<Awaited<R>>> => {
    try {
      return { ok: true, data: await fn(BrowserWindow.fromWebContents(e.sender), ...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

export function broadcast(channel: string): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel)
}

function validate(input: ConnectionInput): void {
  if (!input.name?.trim()) throw new Error('Name is required')
  if (input.kind === 'demo') return
  const ssh = input.options?.ssh
  if (ssh?.enabled) {
    if (!ssh.host?.trim()) throw new Error('SSH host is required')
    if (!ssh.username?.trim()) throw new Error('SSH username is required')
    if (ssh.auth === 'key' && !ssh.privateKeyPath?.trim()) throw new Error('SSH private key file is required')
  }
  if (input.kind === 'mongodb' && input.options?.uri?.trim() && !ssh?.enabled) return
  if (!input.host?.trim()) throw new Error('Host is required')
  if (!input.port) throw new Error('Port is required')
  if (input.kind !== 'mongodb' && !input.database?.trim()) {
    throw new Error(input.kind === 'oracle' ? 'Service name is required' : 'Database is required')
  }
}

function encOrNull(v: string | undefined): string | null | undefined {
  return v === undefined ? undefined : v ? encryptSecret(v) : null
}

export function registerIpc(): void {
  handle('connections:list', () => store.listConnections())

  handle('connections:test', async (input: ConnectionInput, existingId?: string) => {
    validate(input)
    const stored = existingId ? store.getConnection(existingId) : null
    const password = input.password ?? decryptSecret(stored?.secret ?? null)
    const sshSecret = input.sshSecret ?? decryptSecret(stored?.sshSecret ?? null)
    const t0 = performance.now()
    let adapter: Awaited<ReturnType<typeof connectAdapter>> | null = null
    try {
      adapter = await connectAdapter(
        { ...input, id: 'test', createdAt: Date.now(), options: input.options ?? {} },
        password,
        sshSecret
      )
      const serverVersion = await adapter.ping()
      return { ok: true, latencyMs: Math.round(performance.now() - t0), serverVersion } satisfies TestResult
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) } satisfies TestResult
    } finally {
      await adapter?.close().catch(() => {})
    }
  })

  handle('connections:create', async (input: ConnectionInput) => {
    validate(input)
    const id = randomUUID()
    store.insertConnection(id, input, encOrNull(input.password) ?? null, encOrNull(input.sshSecret) ?? null)
    takeSnapshot(id).then(() => broadcast('analytics:updated'))
    return id
  })

  handle('connections:update', async (id: string, input: ConnectionInput) => {
    validate(input)
    store.updateConnection(id, input, encOrNull(input.password), encOrNull(input.sshSecret))
    await dropAdapter(id)
    takeSnapshot(id).then(() => broadcast('analytics:updated'))
    return id
  })

  handle('connections:delete', async (id: string) => {
    await dropAdapter(id)
    store.deleteConnection(id)
    return true
  })

  handle('connections:createDemo', async () => {
    const existing = store.listConnections().find((c) => c.kind === 'demo')
    if (existing) return existing.id
    const id = randomUUID()
    store.insertConnection(
      id,
      { name: 'Kestrel Supply', kind: 'demo', host: 'local', port: 0, database: 'kestrel', username: '', options: {} },
      null
    )
    await takeSnapshot(id)
    broadcast('analytics:updated')
    return id
  })

  handle('connections:detail', (id: string) => services.getConnectionDetail(id))

  handle('analytics:overview', () => services.getOverview())
  handle('analytics:refresh', async (id?: string, minGapMs?: number) => {
    if (id) await takeSnapshot(id)
    else await snapshotAll(minGapMs ?? 0)
    broadcast('analytics:updated')
    return true
  })

  handle('schema:get', (id: string, force?: boolean) => services.getSchema(id, force))
  handle('schema:changes', (id: string) => services.getSchemaChanges(id))
  handle('rows:fetch', (id: string, entity: string, query: RowsQuery) => services.fetchRows(id, entity, query))
  handle('rows:update', (id: string, entity: string, key: string, value: string, changes: Record<string, CellValue>) =>
    services.updateRow(id, entity, key, value, changes)
  )
  handle('record:get', (id: string, entity: string, key: string, value: string) =>
    services.getRecord(id, entity, key, value)
  )
  handle('display:set', (id: string, entity: string, field: string) => {
    store.setDisplayField(id, entity, field)
    return true
  })

  handle('layout:get', (id: string) => store.getLayout(id))
  handle('layout:save', (id: string, positions: NodePositions | null) => {
    store.setLayout(id, positions)
    return true
  })

  handle('query:run', (id: string, text: string, limit: number) => services.runQuery(id, text, limit))
  handle('query:history', (id: string) => store.listQueryHistory(id))
  handle('query:clearHistory', (id: string) => {
    store.clearQueryHistory(id)
    return true
  })

  handle('health:get', (id: string) => insights.getHealth(id))
  handle('health:profile', (id: string, entity: string) => insights.profileEntity(id, entity))

  handle('alerts:list', (id: string) => ({ rules: store.listAlertRules(id), events: store.listAlertEvents(id) }))
  handle('alerts:add', (id: string, kind: AlertKind, threshold: number) => {
    if (!['offline', 'size_gt', 'growth_pct'].includes(kind)) throw new Error('Unknown alert kind')
    if (kind !== 'offline' && !(threshold > 0)) throw new Error('Threshold must be a positive number')
    store.addAlertRule(id, kind, kind === 'offline' ? 0 : threshold)
    return true
  })
  handle('alerts:remove', (ruleId: number) => {
    store.deleteAlertRule(ruleId)
    return true
  })

  handleWin('export:table', (win, id: string, entity: string, format: ExportFormat, filters?: RowFilter[]) =>
    exporter.exportTable(win, id, entity, format, filters)
  )
  handleWin(
    'export:rows',
    (win, name: string, columns: string[], rows: Record<string, CellValue>[], format: ExportFormat) =>
      exporter.exportRows(win, name, columns, rows, format)
  )
  handleWin('export:schema', (win, id: string, format: SchemaExportFormat) => exporter.exportSchema(win, id, format))

  handleWin('dialog:openFile', async (win, title: string) => {
    const opts = { title, properties: ['openFile' as const, 'showHiddenFiles' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
}

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AlertEvent,
  AlertKind,
  AlertRule,
  CellValue,
  ConnectionDetail,
  ConnectionInfo,
  ConnectionInput,
  ExportFormat,
  HealthReport,
  IpcResult,
  NodePositions,
  Overview,
  ProfileResult,
  QueryHistoryItem,
  QueryResult,
  RecordDetail,
  RowFilter,
  RowsQuery,
  RowsResult,
  SchemaChange,
  SchemaExportFormat,
  SchemaInfo,
  TestResult
} from '../shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

type Exported = { path: string; rows?: number } | null

const api = {
  platform: process.platform,
  connections: {
    list: () => call<ConnectionInfo[]>('connections:list'),
    test: (input: ConnectionInput, existingId?: string) => call<TestResult>('connections:test', input, existingId),
    create: (input: ConnectionInput) => call<string>('connections:create', input),
    update: (id: string, input: ConnectionInput) => call<string>('connections:update', id, input),
    remove: (id: string) => call<boolean>('connections:delete', id),
    createDemo: () => call<string>('connections:createDemo'),
    detail: (id: string) => call<ConnectionDetail>('connections:detail', id)
  },
  analytics: {
    overview: () => call<Overview>('analytics:overview'),
    refresh: (id?: string, minGapMs?: number) => call<boolean>('analytics:refresh', id, minGapMs),
    onUpdated: (cb: () => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('analytics:updated', listener)
      return () => {
        ipcRenderer.removeListener('analytics:updated', listener)
      }
    }
  },
  schema: {
    get: (id: string, force?: boolean) => call<SchemaInfo>('schema:get', id, force),
    changes: (id: string) => call<SchemaChange[]>('schema:changes', id)
  },
  rows: {
    fetch: (id: string, entity: string, query: RowsQuery) => call<RowsResult>('rows:fetch', id, entity, query),
    update: (id: string, entity: string, key: string, value: string, changes: Record<string, CellValue>) =>
      call<number>('rows:update', id, entity, key, value, changes)
  },
  record: {
    get: (id: string, entity: string, key: string, value: string) =>
      call<RecordDetail>('record:get', id, entity, key, value)
  },
  display: {
    set: (id: string, entity: string, field: string) => call<boolean>('display:set', id, entity, field)
  },
  layout: {
    get: (id: string) => call<NodePositions | null>('layout:get', id),
    save: (id: string, positions: NodePositions | null) => call<boolean>('layout:save', id, positions)
  },
  query: {
    run: (id: string, text: string, limit: number) => call<QueryResult>('query:run', id, text, limit),
    history: (id: string) => call<QueryHistoryItem[]>('query:history', id),
    clearHistory: (id: string) => call<boolean>('query:clearHistory', id)
  },
  health: {
    get: (id: string) => call<HealthReport>('health:get', id),
    profile: (id: string, entity: string) => call<ProfileResult>('health:profile', id, entity)
  },
  alerts: {
    list: (id: string) => call<{ rules: AlertRule[]; events: AlertEvent[] }>('alerts:list', id),
    add: (id: string, kind: AlertKind, threshold: number) => call<boolean>('alerts:add', id, kind, threshold),
    remove: (ruleId: number) => call<boolean>('alerts:remove', ruleId)
  },
  exports: {
    table: (id: string, entity: string, format: ExportFormat, filters?: RowFilter[]) =>
      call<Exported>('export:table', id, entity, format, filters),
    rows: (name: string, columns: string[], rows: Record<string, CellValue>[], format: ExportFormat) =>
      call<Exported>('export:rows', name, columns, rows, format),
    schema: (id: string, format: SchemaExportFormat) => call<Exported>('export:schema', id, format)
  },
  dialog: {
    openFile: (title: string) => call<string | null>('dialog:openFile', title)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

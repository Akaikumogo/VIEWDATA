import { type BrowserWindow, dialog } from 'electron'
import { createWriteStream, writeFileSync } from 'node:fs'
import type { CellValue, ExportFormat, RowFilter, SchemaExportFormat, SchemaInfo } from '../shared/types'
import { adapterFor } from './adapters'
import { normalizeRow } from './normalize'
import { getSchema } from './services'
import * as store from './store'

const MAX_EXPORT_ROWS = 200_000
const PAGE = 1000

function csvCell(v: CellValue | undefined): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvLine(columns: string[], row: Record<string, CellValue>): string {
  return columns.map((c) => csvCell(row[c])).join(',') + '\r\n'
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_')
}

async function askPath(win: BrowserWindow | null, defaultName: string, ext: string, label: string): Promise<string | null> {
  const opts = { defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  return res.canceled || !res.filePath ? null : res.filePath
}

export async function exportTable(
  win: BrowserWindow | null,
  connectionId: string,
  entity: string,
  format: ExportFormat,
  filters: RowFilter[] = []
): Promise<{ path: string; rows: number } | null> {
  const conn = store.getConnection(connectionId)
  if (!conn) throw new Error('Connection not found')
  const path = await askPath(win, `${safeName(conn.info.name)}-${safeName(entity)}.${format}`, format, format.toUpperCase())
  if (!path) return null
  const [adapter, schema] = await Promise.all([adapterFor(connectionId), getSchema(connectionId)])
  const meta = schema.entities.find((e) => e.name === entity)
  if (!meta) throw new Error(`Unknown entity "${entity}"`)

  const out = createWriteStream(path, { encoding: 'utf8' })
  const write = (s: string) => new Promise<void>((res) => (out.write(s) ? res() : out.once('drain', res)))
  const columns = meta.fields.filter((f) => !f.name.includes('.')).map((f) => f.name)
  let count = 0
  try {
    if (format === 'csv') await write('\ufeff' + columns.map((c) => csvCell(c)).join(',') + '\r\n')
    else await write('[\n')
    for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += PAGE) {
      const page = (await adapter.fetchRows(entity, { limit: PAGE, offset, filters })).map(normalizeRow)
      for (const row of page) {
        await write(format === 'csv' ? csvLine(columns, row) : `${count ? ',\n' : ''}  ${JSON.stringify(row)}`)
        count++
      }
      if (page.length < PAGE) break
    }
    if (format === 'json') await write('\n]\n')
  } finally {
    await new Promise<void>((res) => out.end(res))
  }
  return { path, rows: count }
}

export async function exportRows(
  win: BrowserWindow | null,
  name: string,
  columns: string[],
  rows: Record<string, CellValue>[],
  format: ExportFormat
): Promise<{ path: string; rows: number } | null> {
  const path = await askPath(win, `${safeName(name)}.${format}`, format, format.toUpperCase())
  if (!path) return null
  const body =
    format === 'csv'
      ? '\ufeff' + columns.map((c) => csvCell(c)).join(',') + '\r\n' + rows.map((r) => csvLine(columns, r)).join('')
      : JSON.stringify(rows, null, 2)
  writeFileSync(path, body, 'utf8')
  return { path, rows: rows.length }
}

function dbmlName(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`
}

function mermaidName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_')
}

function mermaidType(t: string): string {
  return (t.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'any').slice(0, 30)
}

export function schemaToText(schema: SchemaInfo, format: SchemaExportFormat): string {
  if (format === 'json') return JSON.stringify(schema, null, 2)
  const fkFields = new Set(schema.relations.map((r) => `${r.from}\u0000${r.fromField}`))
  if (format === 'dbml') {
    const parts: string[] = []
    for (const e of schema.entities) {
      const lines = e.fields
        .filter((f) => !f.name.includes('.'))
        .map((f) => {
          const attrs = [f.isPrimary ? 'pk' : '', !f.nullable && !f.isPrimary ? 'not null' : ''].filter(Boolean)
          return `  ${dbmlName(f.name)} ${dbmlName(f.type.replace(/\s+/g, '_') || 'any')}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`
        })
      parts.push(`Table ${dbmlName(e.name)} {\n${lines.join('\n')}\n}`)
    }
    for (const r of schema.relations) {
      parts.push(`Ref: ${dbmlName(r.from)}.${dbmlName(r.fromField)} > ${dbmlName(r.to)}.${dbmlName(r.toField)}`)
    }
    return parts.join('\n\n') + '\n'
  }
  const lines = ['erDiagram']
  for (const e of schema.entities) {
    lines.push(`  ${mermaidName(e.name)} {`)
    for (const f of e.fields.filter((x) => !x.name.includes('.'))) {
      const keys = [f.isPrimary ? 'PK' : '', fkFields.has(`${e.name}\u0000${f.name}`) ? 'FK' : ''].filter(Boolean).join(',')
      lines.push(`    ${mermaidType(f.type)} ${mermaidName(f.name)}${keys ? ` ${keys}` : ''}`)
    }
    lines.push('  }')
  }
  for (const r of schema.relations) {
    lines.push(`  ${mermaidName(r.to)} ||--o{ ${mermaidName(r.from)} : "${r.fromField.replace(/"/g, "'")}"`)
  }
  return lines.join('\n') + '\n'
}

export async function exportSchema(
  win: BrowserWindow | null,
  connectionId: string,
  format: SchemaExportFormat
): Promise<{ path: string } | null> {
  const conn = store.getConnection(connectionId)
  if (!conn) throw new Error('Connection not found')
  const ext = format === 'mermaid' ? 'mmd' : format
  const path = await askPath(win, `${safeName(conn.info.name)}-schema.${ext}`, ext, format.toUpperCase())
  if (!path) return null
  writeFileSync(path, schemaToText(await getSchema(connectionId), format), 'utf8')
  return { path }
}

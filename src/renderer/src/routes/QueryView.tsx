import { ClockCounterClockwise, DownloadSimple, LockSimple, Play, Trash, WarningCircle } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { type DbKind, type QueryResult, type SchemaInfo, writesAllowed } from '@shared/types'
import { PlainCell } from '@/components/cells'
import { CodeEditor } from '@/components/CodeEditor'
import { Button, Menu } from '@/components/ui'
import { MOD, cn, formatExact, timeAgo } from '@/lib/format'
import { api, qk, useConnectionDetail, useQueryHistory, useSchema } from '@/lib/queries'
import { runExport, toast } from '@/stores/toast'

const LIMITS = [100, 500, 1000, 5000]

function starter(kind: DbKind, schema: SchemaInfo | undefined): string {
  const first = schema?.entities.find((e) => e.kind !== 'view')?.name ?? 'table_name'
  if (kind === 'mongodb') {
    return `{\n  "collection": "${first}",\n  "find": {},\n  "sort": { "_id": -1 },\n  "limit": 50\n}\n`
  }
  if (kind === 'oracle') return `SELECT *\nFROM "${first}"\nFETCH FIRST 50 ROWS ONLY`
  const q = kind === 'mysql' || kind === 'mariadb' ? `\`${first}\`` : `"${first}"`
  return `SELECT *\nFROM ${q}\nLIMIT 50;`
}

function draftKey(dbId: string) {
  return `viewdata.query.${dbId}`
}

export function QueryView() {
  const { dbId = '' } = useParams()
  const qc = useQueryClient()
  const detail = useConnectionDetail(dbId)
  const schema = useSchema(dbId)
  const history = useQueryHistory(dbId)
  const kind = detail.data?.connection.kind
  const canWrite = !!detail.data && writesAllowed(detail.data.connection)
  const [text, setText] = useState(() => localStorage.getItem(draftKey(dbId)) ?? '')
  const [limit, setLimit] = useState(500)
  const [showHistory, setShowHistory] = useState(true)

  useEffect(() => {
    setText(localStorage.getItem(draftKey(dbId)) ?? '')
  }, [dbId])
  useEffect(() => {
    if (!text && kind && schema.data) setText(starter(kind, schema.data))
  }, [text, kind, schema.data])
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(draftKey(dbId), text), 300)
    return () => clearTimeout(t)
  }, [dbId, text])

  const completion = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const e of schema.data?.entities ?? []) out[e.name] = e.fields.filter((f) => !f.name.includes('.')).map((f) => f.name)
    return out
  }, [schema.data])

  const run = useMutation<QueryResult, Error, string>({
    mutationFn: (q) => api.query.run(dbId, q, limit),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.queryHistory(dbId) }),
    onSuccess: (res) => {
      if (!res.columns.length) {
        toast(`${res.command ?? 'Statement'} done${res.rowCount !== null ? ` · ${res.rowCount} rows affected` : ''}`)
        qc.invalidateQueries({ queryKey: ['rows', dbId] })
        qc.invalidateQueries({ queryKey: qk.schema(dbId) })
      }
    }
  })
  const exec = () => {
    if (text.trim() && !run.isPending) run.mutate(text)
  }

  const res = run.data
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b hairline px-5 py-2.5">
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={exec} disabled={run.isPending || !text.trim()}>
              <Play size={12} weight="fill" /> {run.isPending ? 'Running…' : 'Run'}
            </Button>
            <kbd className="font-mono text-[10px] text-zinc-600">{MOD} Enter</kbd>
            <div className="mx-2 h-4 w-px bg-white/[0.06]" />
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              Limit
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-6 rounded-md border border-white/[0.08] bg-ink-900 px-1.5 font-mono text-[11px] text-zinc-300 outline-none"
              >
                {LIMITS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {!canWrite && (
              <span
                className="inline-flex items-center gap-1 rounded-md border hairline px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                title="Only read statements run. Enable 'Allow writes' in the connection settings to change data."
              >
                <LockSimple size={10} /> read-only
              </span>
            )}
            {kind === 'mongodb' && (
              <span className="text-[11px] text-zinc-600">
                JSON with <span className="font-mono text-zinc-500">collection</span> +{' '}
                <span className="font-mono text-zinc-500">find</span> or <span className="font-mono text-zinc-500">aggregate</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Menu
              disabled={!res?.columns.length}
              label={
                <>
                  <DownloadSimple size={13} /> Export
                </>
              }
              items={(['csv', 'json'] as const).map((f) => ({
                label: f.toUpperCase(),
                hint: res ? `${res.rows.length} rows` : undefined,
                onSelect: () => res && runExport(api.exports.rows('query-result', res.columns, res.rows, f))
              }))}
            />
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((s) => !s)} className={cn(showHistory && 'text-zinc-100')}>
              <ClockCounterClockwise size={13} /> History
            </Button>
          </div>
        </div>

        <div className="h-[38%] min-h-[140px] shrink-0 border-b hairline bg-ink-950/40">
          {kind && (
            <CodeEditor
              value={text}
              onChange={setText}
              onRun={exec}
              kind={kind}
              schema={completion}
              placeholder={kind === 'mongodb' ? '{ "collection": "...", "find": {} }' : 'SELECT …'}
            />
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto">
          {run.isPending && (
            <motion.div
              className="absolute top-0 left-0 z-20 h-px bg-accent"
              initial={{ width: '0%' }}
              animate={{ width: '85%' }}
              transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
            />
          )}
          {run.isError ? (
            <div className="m-5 flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/[0.04] p-4">
              <WarningCircle size={18} weight="duotone" className="mt-0.5 shrink-0 text-danger" />
              <pre className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-zinc-300">
                {run.error.message}
              </pre>
            </div>
          ) : !res ? (
            <div className="grid h-full place-items-center">
              <p className="text-xs text-zinc-600">Run a query to see results here.</p>
            </div>
          ) : !res.columns.length ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="text-sm text-zinc-300">{res.command ?? 'Statement'} completed</p>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {res.rowCount ?? 0} rows affected · {res.durationMs} ms
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="sticky top-0 left-0 z-20 flex items-center gap-3 border-b hairline bg-ink-950/95 px-5 py-1.5 font-mono text-[11px] text-zinc-500 backdrop-blur">
                <span className="text-zinc-300">{formatExact(res.rows.length)} rows</span>
                <span>{res.durationMs} ms</span>
                {res.truncated && <span className="text-warn">limited to {limit}; raise the limit to see more</span>}
              </div>
              <table className="w-max min-w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky top-[29px] left-0 z-10 w-12 border-b hairline bg-ink-925 px-3" />
                    {res.columns.map((c) => (
                      <th
                        key={c}
                        className="sticky top-[29px] z-10 h-9 border-b hairline bg-ink-925 px-3 text-left text-xs font-medium text-zinc-200"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((row, i) => (
                    <tr key={i} className="group">
                      <td className="sticky left-0 border-b border-white/[0.035] bg-ink-950 px-3 py-2 text-right font-mono text-[10.5px] text-zinc-700 group-hover:bg-ink-900">
                        {i + 1}
                      </td>
                      {res.columns.map((c) => (
                        <td key={c} className="border-b border-white/[0.035] px-3 py-2 whitespace-nowrap group-hover:bg-white/[0.015]">
                          <PlainCell value={row[c] ?? null} field={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {showHistory && (
        <aside className="flex w-72 shrink-0 flex-col border-l hairline bg-ink-925/60">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">History</span>
            {!!history.data?.length && (
              <button
                onClick={async () => {
                  await api.query.clearHistory(dbId)
                  qc.invalidateQueries({ queryKey: qk.queryHistory(dbId) })
                }}
                className="text-zinc-600 hover:text-zinc-300"
                title="Clear history"
              >
                <Trash size={12} />
              </button>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {!history.data?.length && <li className="px-2 py-6 text-center text-xs text-zinc-600">Queries you run appear here.</li>}
            {history.data?.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => setText(h.text)}
                  className="group w-full rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04]"
                  title={h.error ?? undefined}
                >
                  <pre className="line-clamp-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300 group-hover:text-zinc-100">
                    {h.text.trim()}
                  </pre>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-600">
                    <span className={cn('size-1.5 rounded-full', h.ok ? 'bg-accent/70' : 'bg-danger')} />
                    {timeAgo(h.ranAt)}
                    {h.durationMs !== null && <span>· {h.durationMs} ms</span>}
                    {h.rowCount !== null && h.ok && <span>· {h.rowCount} rows</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}

import { ArrowsClockwise, DownloadSimple, Graph, Table } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { KIND_LABEL } from '@shared/types'
import { AlertsPanel } from '@/components/AlertsPanel'
import { AreaChart, Button, ErrorState, Menu, Skeleton, Sparkline, Stat } from '@/components/ui'
import { runExport } from '@/stores/toast'
import { cn, formatBytes, formatCount, timeAgo } from '@/lib/format'
import { api, qk, useConnectionDetail, useSchema } from '@/lib/queries'

const spring = { type: 'spring' as const, stiffness: 100, damping: 20 }
const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring } }

export function DbOverview() {
  const { dbId = '' } = useParams()
  const qc = useQueryClient()
  const detail = useConnectionDetail(dbId)
  const schema = useSchema(dbId)
  const [refreshing, setRefreshing] = useState(false)

  const degree = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of schema.data?.relations ?? []) {
      m.set(r.from, (m.get(r.from) ?? 0) + 1)
      m.set(r.to, (m.get(r.to) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)
  }, [schema.data])

  const largest = useMemo(
    () =>
      [...(schema.data?.entities ?? [])]
        .filter((e) => e.kind !== 'view')
        .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || (b.rowCount ?? 0) - (a.rowCount ?? 0))
        .slice(0, 9),
    [schema.data]
  )

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.analytics.refresh(dbId)
      const fresh = await api.schema.get(dbId, true)
      qc.setQueryData(qk.schema(dbId), fresh)
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.detail(dbId) }),
        qc.invalidateQueries({ queryKey: qk.overview })
      ])
    } catch {
      /* surfaced via query error states */
    } finally {
      setRefreshing(false)
    }
  }

  const conn = detail.data?.connection
  const latest = detail.data?.latest
  const series = (detail.data?.history ?? [])
    .filter((s) => s.status === 'ok' && s.sizeBytes !== null)
    .map((s) => ({ t: s.takenAt, v: s.sizeBytes! }))
  const maxSize = Math.max(1, ...largest.map((e) => e.sizeBytes ?? 0))

  return (
    <div className="h-full overflow-y-auto">
      <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-[1400px] px-8 py-8">
        <motion.div variants={item} className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-wide text-accent uppercase">
              {conn ? KIND_LABEL[conn.kind] : '\u00a0'}
            </p>
            <h1 className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-zinc-50">{conn?.name ?? '…'}</h1>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500">
              {conn && conn.kind !== 'demo' ? `${conn.username ? `${conn.username}@` : ''}${conn.host}:${conn.port}/${conn.database}` : 'in-memory sample database'}
              {latest && ` · snapshot ${timeAgo(latest.takenAt)}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Menu
              label={
                <>
                  <DownloadSimple size={13} /> Export schema
                </>
              }
              items={[
                { label: 'DBML', hint: 'dbdiagram.io', onSelect: () => runExport(api.exports.schema(dbId, 'dbml')) },
                { label: 'Mermaid', hint: 'erDiagram', onSelect: () => runExport(api.exports.schema(dbId, 'mermaid')) },
                { label: 'JSON', hint: 'raw', onSelect: () => runExport(api.exports.schema(dbId, 'json')) }
              ]}
            />
            <Button variant="ghost" onClick={refresh} disabled={refreshing}>
              <ArrowsClockwise size={14} className={cn(refreshing && 'animate-spin')} /> Refresh
            </Button>
            <Link to={`/db/${dbId}/schema`}>
              <Button variant="primary">
                <Graph size={14} weight="bold" /> View as schema
              </Button>
            </Link>
          </div>
        </motion.div>

        {schema.isError && (
          <motion.div variants={item} className="mt-6">
            <ErrorState
              title="Could not read the schema"
              message={(schema.error as Error).message}
              action={
                <Button size="sm" onClick={() => schema.refetch()}>
                  Try again
                </Button>
              }
            />
          </motion.div>
        )}

        <motion.section
          variants={item}
          className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hairline bg-white/[0.04] lg:grid-cols-4"
        >
          {[
            { label: 'Size on disk', value: formatBytes(latest?.sizeBytes) },
            { label: conn?.kind === 'mongodb' ? 'Collections' : 'Tables', value: formatCount(schema.data?.entities.length) },
            { label: 'Rows', value: formatCount(latest?.rowCount) },
            {
              label: 'Relations',
              value: formatCount(schema.data?.relations.length),
              hint: conn?.kind === 'mongodb' ? 'inferred from sampled documents' : 'declared foreign keys'
            }
          ].map((s) => (
            <div key={s.label} className="bg-ink-900 p-5">
              {schema.isLoading && s.label !== 'Size on disk' && s.label !== 'Rows' ? (
                <>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-3 h-7 w-20" />
                </>
              ) : (
                <Stat label={s.label} value={s.value} hint={s.hint} />
              )}
            </div>
          ))}
        </motion.section>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
          <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60 p-6">
            <h2 className="text-sm font-medium text-zinc-200">Growth</h2>
            <p className="mt-0.5 text-xs text-zinc-600">size from stored snapshots</p>
            <div className="mt-5">
              <AreaChart points={series} format={formatBytes} height={170} />
            </div>
          </motion.section>

          <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60 p-6">
            <AlertsPanel dbId={dbId} />
          </motion.section>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.6fr]">
          <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60 p-6">
            <h2 className="text-sm font-medium text-zinc-200">Most connected</h2>
            <p className="mt-0.5 text-xs text-zinc-600">tables with the most relations</p>
            <ul className="mt-4 divide-y divide-white/[0.05]">
              {schema.isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="py-2.5">
                    <Skeleton className="h-3.5 w-full" />
                  </li>
                ))}
              {degree.map(([name, n]) => (
                <li key={name}>
                  <Link
                    to={`/db/${dbId}/table/${encodeURIComponent(name)}`}
                    className="flex items-center justify-between py-2.5 text-[13px] text-zinc-300 hover:text-accent"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Table size={13} className="text-zinc-600" /> {name}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">{n} links</span>
                  </Link>
                </li>
              ))}
              {schema.data && degree.length === 0 && (
                <li className="py-4 text-xs text-zinc-600">No relations found in this database.</li>
              )}
            </ul>
          </motion.section>

        <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60 px-6 pt-5 pb-3">
          <h2 className="text-sm font-medium text-zinc-200">Largest tables</h2>
          <div className="mt-3 grid grid-cols-[1fr_minmax(80px,1.4fr)_72px_72px_72px_40px] gap-x-4 border-b hairline pb-2 text-[11px] tracking-wide text-zinc-600 uppercase">
            <span>Name</span>
            <span>Share</span>
            <span>Trend</span>
            <span className="text-right">Rows</span>
            <span className="text-right">Size</span>
            <span className="text-right">Idx</span>
          </div>
          <ul className="divide-y divide-white/[0.04]">
            {largest.map((e, i) => (
              <li key={e.name}>
                <Link
                  to={`/db/${dbId}/table/${encodeURIComponent(e.name)}`}
                  className="grid grid-cols-[1fr_minmax(80px,1.4fr)_72px_72px_72px_40px] items-center gap-x-4 py-2.5 text-[13px] hover:bg-white/[0.02]"
                >
                  <span className="truncate text-zinc-200">{e.name}</span>
                  <span className="h-1 overflow-hidden rounded-full bg-white/[0.04]">
                    <motion.span
                      className="block h-full rounded-full bg-accent/60"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(1.5, ((e.sizeBytes ?? 0) / maxSize) * 100)}%` }}
                      transition={{ ...spring, delay: 0.2 + i * 0.04 }}
                    />
                  </span>
                  <span title="Rows over the last 30 days">
                    <Sparkline
                      values={(detail.data?.entityHistory[e.name] ?? []).map((p) => p.rows ?? 0)}
                      className="h-5 w-full text-accent/70"
                      height={20}
                    />
                  </span>
                  <span className="text-right font-mono text-xs text-zinc-400">{formatCount(e.rowCount)}</span>
                  <span className="text-right font-mono text-xs text-zinc-400">{formatBytes(e.sizeBytes)}</span>
                  <span className="text-right font-mono text-xs text-zinc-600">{e.indexCount ?? '—'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </motion.section>
        </div>
      </motion.div>
    </div>
  )
}

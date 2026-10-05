import { ArrowRight, ArrowsClockwise, Database, Plus } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { memo, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KIND_LABEL, type DbKind, type Overview, type Snapshot } from '@shared/types'
import { AreaChart, Button, KindBadge, Skeleton, Sparkline, Stat, StatusDot } from '@/components/ui'
import { cn, formatBytes, formatCount, timeAgo } from '@/lib/format'
import { api, qk, useOverview } from '@/lib/queries'
import { useUi } from '@/stores/ui'

const spring = { type: 'spring' as const, stiffness: 100, damping: 20 }
const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: spring } }

/** Sum of the latest known size of every connection, sampled at each snapshot */
function fleetSeries(history: Snapshot[]): { t: number; v: number }[] {
  const latest = new Map<string, number>()
  const out: { t: number; v: number }[] = []
  for (const s of history) {
    if (s.status !== 'ok' || s.sizeBytes === null) continue
    latest.set(s.connectionId, s.sizeBytes)
    let sum = 0
    for (const v of latest.values()) sum += v
    const prev = out[out.length - 1]
    if (prev && s.takenAt - prev.t < 60_000) prev.v = sum
    else out.push({ t: s.takenAt, v: sum })
  }
  return out
}

function useFleet(data?: Overview) {
  return useMemo(() => {
    if (!data) return null
    const latest = data.connections.map((c) => data.latest[c.id]).filter(Boolean) as Snapshot[]
    const ok = latest.filter((s) => s.status === 'ok')
    const lat = ok.map((s) => s.latencyMs ?? 0).sort((a, b) => a - b)
    const mix = new Map<DbKind, number>()
    for (const c of data.connections) mix.set(c.kind, (mix.get(c.kind) ?? 0) + 1)
    return {
      size: ok.reduce((s, x) => s + (x.sizeBytes ?? 0), 0),
      rows: ok.reduce((s, x) => s + (x.rowCount ?? 0), 0),
      entities: ok.reduce((s, x) => s + (x.entityCount ?? 0), 0),
      online: ok.length,
      median: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      lastAt: Math.max(0, ...latest.map((s) => s.takenAt)),
      series: fleetSeries(data.history),
      mix: [...mix.entries()].sort((a, b) => b[1] - a[1])
    }
  }, [data])
}

const SchemaIllustration = memo(function SchemaIllustration() {
  const nodes = [
    { x: 40, y: 50, w: 120, rows: 4 },
    { x: 250, y: 20, w: 130, rows: 5 },
    { x: 250, y: 190, w: 120, rows: 3 },
    { x: 450, y: 110, w: 110, rows: 4 }
  ]
  const links = [
    'M160,82 C205,82 205,52 250,52',
    'M160,104 C205,104 205,222 250,222',
    'M380,74 C415,74 415,142 450,142',
    'M370,244 C410,244 410,164 450,164'
  ]
  return (
    <svg viewBox="0 0 600 300" className="w-full" aria-hidden>
      {links.map((d, i) => (
        <motion.path
          key={d}
          d={d}
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity="0.55"
          strokeWidth="1.25"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.6 + i * 0.25, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
      {links.map((d, i) => (
        <circle key={`dot-${i}`} r="2" fill="var(--color-accent)">
          <animateMotion dur={`${3.2 + i * 0.6}s`} repeatCount="indefinite" path={d} begin={`${1.8 + i * 0.3}s`} />
        </circle>
      ))}
      {nodes.map((n, i) => (
        <motion.g
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.12, ...spring }}
        >
          <rect x={n.x} y={n.y} width={n.w} height={22 + n.rows * 22} rx="9" fill="#111114" stroke="rgb(255 255 255 / 0.08)" />
          <rect x={n.x + 12} y={n.y + 8} width={n.w * 0.45} height="6" rx="3" fill="rgb(255 255 255 / 0.5)" />
          {Array.from({ length: n.rows }).map((_, r) => (
            <g key={r}>
              <line x1={n.x} x2={n.x + n.w} y1={n.y + 22 + r * 22} y2={n.y + 22 + r * 22} stroke="rgb(255 255 255 / 0.05)" />
              <rect x={n.x + 12} y={n.y + 30 + r * 22} width={n.w * (0.3 + ((r * 37 + i * 11) % 30) / 100)} height="5" rx="2.5" fill="rgb(255 255 255 / 0.16)" />
            </g>
          ))}
        </motion.g>
      ))}
    </svg>
  )
})

function EmptyHome() {
  const openNew = useUi((s) => s.openNew)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const openDemo = async () => {
    setBusy(true)
    try {
      const id = await api.connections.createDemo()
      await qc.invalidateQueries({ queryKey: qk.overview })
      navigate(`/db/${id}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid h-full grid-cols-1 items-center gap-12 px-12 lg:grid-cols-[1fr_1.1fr]">
      <motion.div variants={container} initial="hidden" animate="show" className="max-w-md">
        <motion.p variants={item} className="font-mono text-[11px] tracking-wide text-accent uppercase">
          Postgres · MySQL · MariaDB · Oracle · MongoDB
        </motion.p>
        <motion.h1 variants={item} className="mt-4 text-4xl leading-[1.05] font-semibold tracking-tighter text-zinc-50">
          Every database you run, on one dark screen.
        </motion.h1>
        <motion.p variants={item} className="mt-4 text-[15px] leading-relaxed text-zinc-400">
          Connect a server and Viewdata reads its tables, foreign keys and sizes, tracks them over time, and draws the
          schema so related tables sit next to each other.
        </motion.p>
        <motion.div variants={item} className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" onClick={openNew}>
            <Plus size={14} weight="bold" /> Add connection
          </Button>
          <Button variant="outline" onClick={openDemo} disabled={busy}>
            <Database size={14} /> Open sample database
          </Button>
        </motion.div>
      </motion.div>
      <div className="hidden lg:block">
        <SchemaIllustration />
      </div>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-6 p-8">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}

export function Home() {
  const { data, isLoading } = useOverview()
  const fleet = useFleet(data)
  const qc = useQueryClient()
  const openNew = useUi((s) => s.openNew)
  const [refreshing, setRefreshing] = useState(false)

  const historyBy = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const s of data?.history ?? []) {
      if (s.status !== 'ok' || s.sizeBytes === null) continue
      m.set(s.connectionId, [...(m.get(s.connectionId) ?? []), s.sizeBytes])
    }
    return m
  }, [data])

  if (isLoading) return <HomeSkeleton />
  if (!data || !fleet || data.connections.length === 0) return <EmptyHome />

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.analytics.refresh()
      await qc.invalidateQueries({ queryKey: qk.overview })
    } finally {
      setRefreshing(false)
    }
  }

  const maxEntity = Math.max(1, ...data.topEntities.map((e) => e.sizeBytes ?? 0))
  const totalKinds = data.connections.length

  return (
    <div className="h-full overflow-y-auto">
      <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-[1400px] px-8 py-8">
        <motion.div variants={item} className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Fleet overview</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {fleet.online} of {data.connections.length} databases reachable · last snapshot {timeAgo(fleet.lastAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={refresh} disabled={refreshing}>
              <ArrowsClockwise size={14} className={cn(refreshing && 'animate-spin')} /> Snapshot now
            </Button>
            <Button variant="outline" onClick={openNew}>
              <Plus size={14} weight="bold" /> Add connection
            </Button>
          </div>
        </motion.div>

        <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
          <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60 p-6">
            <div className="flex items-start justify-between">
              <Stat label="Total footprint" value={formatBytes(fleet.size)} hint="data + indexes across reachable databases" />
              <span className="font-mono text-[11px] text-zinc-600">30 days</span>
            </div>
            <div className="mt-6">
              <AreaChart points={fleet.series} format={formatBytes} height={190} />
            </div>
          </motion.section>

          <motion.section variants={item} className="grid grid-rows-[auto_auto_1fr] gap-px overflow-hidden rounded-2xl border hairline bg-white/[0.04]">
            <div className="grid grid-cols-2 gap-px">
              <div className="bg-ink-900 p-5">
                <Stat label="Rows tracked" value={formatCount(fleet.rows)} />
              </div>
              <div className="bg-ink-900 p-5">
                <Stat label="Tables" value={formatCount(fleet.entities)} hint="incl. collections" />
              </div>
            </div>
            <div className="bg-ink-900 p-5">
              <Stat
                label="Median latency"
                value={fleet.median === null ? '—' : `${fleet.median} ms`}
                hint="ping from this machine"
              />
            </div>
            <div className="bg-ink-900 p-5">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Engine mix</p>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[0.04]">
                {fleet.mix.map(([k, n], i) => (
                  <motion.div
                    key={k}
                    initial={{ width: 0 }}
                    animate={{ width: `${(n / totalKinds) * 100}%` }}
                    transition={{ ...spring, delay: 0.2 + i * 0.08 }}
                    className="h-full border-r-2 border-ink-900 last:border-r-0"
                    style={{ background: `color-mix(in oklch, var(--color-accent) ${100 - i * 22}%, #3f3f46)` }}
                  />
                ))}
              </div>
              <ul className="mt-3 space-y-1.5">
                {fleet.mix.map(([k, n]) => (
                  <li key={k} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">{KIND_LABEL[k]}</span>
                    <span className="font-mono text-zinc-500">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.section>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_1fr]">
          <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-sm font-medium text-zinc-200">Connections</h2>
              <span className="text-xs text-zinc-600">size trend · 30d</span>
            </div>
            <ul className="divide-y divide-white/[0.05]">
              {data.connections.map((c) => {
                const s = data.latest[c.id]
                return (
                  <li key={c.id}>
                    <Link
                      to={`/db/${c.id}`}
                      className="group grid grid-cols-[auto_1fr_80px_72px_60px_20px] items-center gap-4 px-6 py-3 transition-colors hover:bg-white/[0.025]"
                    >
                      <KindBadge kind={c.kind} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-zinc-100">{c.name}</span>
                          <StatusDot snapshot={s} />
                        </div>
                        <p className="truncate text-xs text-zinc-500">
                          {s?.status === 'error' ? (
                            <span className="text-danger/80">{s.error}</span>
                          ) : (
                            `${formatCount(s?.entityCount)} tables · ${formatCount(s?.rowCount)} rows · ${timeAgo(s?.takenAt)}`
                          )}
                        </p>
                      </div>
                      <Sparkline values={historyBy.get(c.id) ?? []} className="h-7 w-20 text-accent/70" />
                      <span className="text-right font-mono text-xs text-zinc-300">{formatBytes(s?.sizeBytes)}</span>
                      <span className="text-right font-mono text-xs text-zinc-500">
                        {s?.latencyMs != null ? `${s.latencyMs}ms` : '—'}
                      </span>
                      <ArrowRight
                        size={13}
                        className="text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-300"
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </motion.section>

          <motion.section variants={item} className="rounded-2xl border hairline bg-ink-900/60 px-6 pt-5 pb-6">
            <h2 className="text-sm font-medium text-zinc-200">Largest tables</h2>
            <p className="mt-0.5 text-xs text-zinc-600">across every connection</p>
            {data.topEntities.length === 0 ? (
              <p className="mt-6 text-xs text-zinc-600">Sizes appear after the first successful snapshot.</p>
            ) : (
              <ul className="mt-5 space-y-3.5">
                {data.topEntities.slice(0, 8).map((e, i) => (
                  <li key={`${e.connectionId}:${e.entity}`}>
                    <Link to={`/db/${e.connectionId}/table/${encodeURIComponent(e.entity)}`} className="group block">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate">
                          <span className="text-zinc-200 group-hover:text-accent">{e.entity}</span>
                          <span className="text-zinc-600"> · {e.connectionName}</span>
                        </span>
                        <span className="shrink-0 font-mono text-zinc-400">{formatBytes(e.sizeBytes)}</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                        <motion.div
                          className="h-full rounded-full bg-accent/70"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(2, ((e.sizeBytes ?? 0) / maxEntity) * 100)}%` }}
                          transition={{ ...spring, delay: 0.3 + i * 0.05 }}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        </div>
      </motion.div>
    </div>
  )
}

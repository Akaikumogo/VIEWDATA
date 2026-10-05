import {
  ArrowLeft,
  ArrowsClockwise,
  CaretRight,
  ClockCounterClockwise,
  Eye,
  Graph,
  Heartbeat,
  Key,
  LinkSimple,
  MagnifyingGlass,
  SquaresFour,
  Table,
  Terminal
} from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import type { EntityMeta, Relation } from '@shared/types'
import { cn, formatCount } from '@/lib/format'
import { api, qk, useConnectionDetail, useSchema } from '@/lib/queries'
import { KindBadge, Skeleton, StatusDot } from './ui'

const NAV = [
  { to: '', label: 'Overview', Icon: SquaresFour, end: true },
  { to: '/schema', label: 'Schema', Icon: Graph, end: false },
  { to: '/query', label: 'Query', Icon: Terminal, end: false },
  { to: '/health', label: 'Health', Icon: Heartbeat, end: false },
  { to: '/changes', label: 'Changes', Icon: ClockCounterClockwise, end: false }
]

function EntityItem({
  dbId,
  entity,
  outgoing,
  index
}: {
  dbId: string
  entity: EntityMeta
  outgoing: Map<string, Relation>
  index: number
}) {
  const [open, setOpen] = useState(false)
  const Icon = entity.kind === 'view' ? Eye : Table
  const fields = entity.fields.filter((f) => !f.name.includes('.'))
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.018, 0.4), type: 'spring', stiffness: 300, damping: 28 }}
    >
      <div className="group flex items-center rounded-lg transition-colors hover:bg-white/[0.035]">
        <button
          onClick={() => setOpen((o) => !o)}
          className="grid size-7 shrink-0 place-items-center text-zinc-600 hover:text-zinc-300"
          aria-label={open ? 'Collapse fields' : 'Expand fields'}
        >
          <CaretRight size={11} weight="bold" className={cn('transition-transform duration-300', open && 'rotate-90')} />
        </button>
        <NavLink
          to={`/db/${dbId}/table/${encodeURIComponent(entity.name)}`}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-[13px]',
              isActive ? 'text-accent' : 'text-zinc-300 hover:text-zinc-100'
            )
          }
        >
          <Icon size={14} className="shrink-0 opacity-70" />
          <span className="truncate">{entity.name}</span>
          <span className="ml-auto font-mono text-[10.5px] text-zinc-600">{formatCount(entity.rowCount)}</span>
        </NavLink>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="ml-[13px] overflow-hidden border-l hairline pl-3"
          >
            {fields.map((f) => {
              const fk = outgoing.get(f.name)
              return (
                <li key={f.name} className="flex items-center gap-1.5 py-[3px] text-[11.5px]">
                  {f.isPrimary ? (
                    <Key size={11} weight="fill" className="shrink-0 text-warn" />
                  ) : fk ? (
                    <LinkSimple size={11} weight="bold" className="shrink-0 text-accent" />
                  ) : (
                    <span className="size-[11px] shrink-0" />
                  )}
                  <span className={cn('truncate', f.isPrimary || fk ? 'text-zinc-200' : 'text-zinc-400')}>{f.name}</span>
                  <span className="ml-auto truncate pl-2 font-mono text-[10px] text-zinc-600">
                    {fk ? `→ ${fk.to}` : f.type}
                  </span>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

export function DbSidebar() {
  const { dbId = '' } = useParams()
  const qc = useQueryClient()
  const { data: detail } = useConnectionDetail(dbId)
  const { data: schema, isLoading, isFetching } = useSchema(dbId)
  const [query, setQuery] = useState('')
  const conn = detail?.connection

  const outgoingByEntity = useMemo(() => {
    const m = new Map<string, Map<string, Relation>>()
    for (const r of schema?.relations ?? []) {
      const inner = m.get(r.from) ?? new Map()
      inner.set(r.fromField, r)
      m.set(r.from, inner)
    }
    return m
  }, [schema])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = schema?.entities ?? []
    return q
      ? list.filter((e) => e.name.toLowerCase().includes(q) || e.fields.some((f) => f.name.toLowerCase().includes(q)))
      : list
  }, [schema, query])

  const refresh = async () => {
    const fresh = await api.schema.get(dbId, true)
    qc.setQueryData(qk.schema(dbId), fresh)
    qc.invalidateQueries({ queryKey: ['rows', dbId] })
    qc.invalidateQueries({ queryKey: qk.changes(dbId) })
    qc.invalidateQueries({ queryKey: qk.health(dbId) })
  }

  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex flex-col items-center justify-center gap-1 rounded-md py-1.5 transition-colors',
      isActive ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
    )

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft size={11} weight="bold" /> All databases
        </Link>
        <div className="mt-2 flex items-center gap-3 px-1.5">
          {conn && <KindBadge kind={conn.kind} className="size-9 text-[11px]" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold tracking-tight text-zinc-50">{conn?.name ?? '…'}</h2>
              <StatusDot snapshot={detail?.latest} />
            </div>
            <p className="truncate font-mono text-[11px] text-zinc-500">
              {schema ? `${schema.entities.length} entities · ${schema.relations.length} relations` : 'introspecting…'}
            </p>
          </div>
          <button
            onClick={refresh}
            title="Re-read schema from the database"
            className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"
          >
            <ArrowsClockwise size={13} className={cn(isFetching && 'animate-spin')} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-0.5 rounded-lg border hairline bg-ink-950/50 p-1">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink key={label} end={end} to={`/db/${dbId}${to}`} className={navCls} title={label}>
              <Icon size={14} />
              <span className="text-[10px] leading-none">{label}</span>
            </NavLink>
          ))}
        </div>
        <div className="relative mt-3">
          <MagnifyingGlass size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tables and columns"
            className="h-8 w-full rounded-lg border hairline bg-ink-950/60 pr-2 pl-8 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-accent/40"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between px-4 pb-1.5">
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
          {conn?.kind === 'mongodb' ? 'Collections' : 'Tables'}
        </span>
        <span className="font-mono text-[11px] text-zinc-600">{filtered.length}</span>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading &&
          Array.from({ length: 9 }).map((_, i) => (
            <li key={i} className="flex items-center gap-2 px-2 py-2">
              <Skeleton className="size-3.5" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-8" />
            </li>
          ))}
        {filtered.map((e, i) => (
          <EntityItem
            key={e.name}
            dbId={dbId}
            entity={e}
            index={i}
            outgoing={outgoingByEntity.get(e.name) ?? new Map()}
          />
        ))}
        {schema && filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-zinc-600">Nothing matches “{query}”.</li>
        )}
      </ul>
    </div>
  )
}

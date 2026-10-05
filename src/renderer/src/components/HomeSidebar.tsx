import { DotsThreeVertical, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { ConnectionInfo } from '@shared/types'
import { cn, formatBytes } from '@/lib/format'
import { api, qk, useOverview } from '@/lib/queries'
import { useUi } from '@/stores/ui'
import { Button, KindBadge, Skeleton, StatusDot } from './ui'

function ConnectionRow({ c, index }: { c: ConnectionInfo; index: number }) {
  const qc = useQueryClient()
  const { data } = useOverview()
  const openEdit = useUi((s) => s.openEdit)
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const snap = data?.latest[c.id]

  const remove = async () => {
    await api.connections.remove(c.id)
    qc.invalidateQueries({ queryKey: qk.overview })
    qc.invalidateQueries({ queryKey: qk.connections })
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26, delay: index * 0.035 }}
      className="group relative"
      onMouseLeave={() => {
        setMenu(false)
        setConfirm(false)
      }}
    >
      <NavLink
        to={`/db/${c.id}`}
        className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.04]"
      >
        <KindBadge kind={c.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-zinc-100">{c.name}</span>
            <StatusDot snapshot={snap} />
          </div>
          <p className="truncate font-mono text-[11px] text-zinc-500">
            {c.kind === 'demo' ? 'in-memory sample' : `${c.host}${c.database ? ` / ${c.database}` : ''}`}
          </p>
        </div>
        <span className="font-mono text-[11px] text-zinc-500 group-hover:opacity-0">
          {snap?.status === 'ok' ? formatBytes(snap.sizeBytes) : snap ? 'offline' : ''}
        </span>
      </NavLink>
      <button
        onClick={() => setMenu((m) => !m)}
        className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/[0.06] hover:text-zinc-200"
        aria-label="Connection actions"
      >
        <DotsThreeVertical size={14} weight="bold" />
      </button>
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="glass absolute top-full right-1 z-30 mt-1 w-40 rounded-lg p-1"
          >
            {c.kind !== 'demo' && (
              <button
                onClick={() => {
                  setMenu(false)
                  openEdit(c)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06]"
              >
                <PencilSimple size={13} /> Edit
              </button>
            )}
            <button
              onClick={() => (confirm ? remove() : setConfirm(true))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-danger hover:bg-danger/10"
            >
              <Trash size={13} /> {confirm ? 'Click to confirm' : 'Remove'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

export function HomeSidebar() {
  const { data, isLoading } = useOverview()
  const openNew = useUi((s) => s.openNew)
  const connections = data?.connections ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Databases</span>
        <span className="font-mono text-[11px] text-zinc-600">{connections.length}</span>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-2.5 py-2">
              <Skeleton className="size-7" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </li>
          ))}
        <AnimatePresence initial={false}>
          {connections.map((c, i) => (
            <ConnectionRow key={c.id} c={c} index={i} />
          ))}
        </AnimatePresence>
        {!isLoading && connections.length === 0 && (
          <li className="mx-2 mt-2 rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-xs leading-relaxed text-zinc-500">
            No databases yet. Connections you add show up here with live status.
          </li>
        )}
      </ul>
      <div className="border-t hairline p-3">
        <Button variant="outline" className={cn('w-full')} onClick={openNew}>
          <Plus size={14} weight="bold" /> Add connection
        </Button>
      </div>
    </div>
  )
}

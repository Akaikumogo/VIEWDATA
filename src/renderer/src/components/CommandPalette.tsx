import {
  ArrowsClockwise,
  ClockCounterClockwise,
  Database,
  DownloadSimple,
  Eye,
  Graph,
  Heartbeat,
  House,
  type Icon,
  Lightning,
  MagnifyingGlass,
  Plus,
  SquaresFour,
  Table,
  Terminal
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/format'
import { api, qk, useConnections } from '@/lib/queries'
import { useLive } from '@/stores/live'
import { runExport, toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: Icon
  run: () => void
}

/** Subsequence match; lower is better, null means no match */
function score(text: string, q: string): number | null {
  if (!q) return 0
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) return direct
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    gaps += found - ti
    ti = found + 1
  }
  return 100 + gaps
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const db = useMatch('/db/:dbId/*')
  const dbId = db?.params.dbId ?? ''
  const { data: connections } = useConnections()
  const schema = useQuery({
    queryKey: qk.schema(dbId),
    queryFn: () => api.schema.get(dbId),
    enabled: open && !!dbId,
    staleTime: Infinity,
    retry: false
  })
  const { live, toggle } = useLive()
  const openNew = useUi((s) => s.openNew)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    const out: Command[] = [
      { id: 'home', group: 'Go to', label: 'Overview', icon: House, run: go('/') }
    ]
    if (dbId) {
      out.push(
        { id: 'db', group: 'Go to', label: 'Database overview', icon: SquaresFour, run: go(`/db/${dbId}`) },
        { id: 'schema', group: 'Go to', label: 'Schema', icon: Graph, run: go(`/db/${dbId}/schema`) },
        { id: 'query', group: 'Go to', label: 'Query editor', icon: Terminal, run: go(`/db/${dbId}/query`) },
        { id: 'health', group: 'Go to', label: 'Health', icon: Heartbeat, run: go(`/db/${dbId}/health`) },
        { id: 'changes', group: 'Go to', label: 'Schema changes', icon: ClockCounterClockwise, run: go(`/db/${dbId}/changes`) }
      )
      for (const e of schema.data?.entities ?? []) {
        out.push({
          id: `t:${e.name}`,
          group: 'Tables',
          label: e.name,
          hint: e.kind,
          icon: e.kind === 'view' ? Eye : Table,
          run: go(`/db/${dbId}/table/${encodeURIComponent(e.name)}`)
        })
      }
    }
    for (const c of connections ?? []) {
      out.push({ id: `c:${c.id}`, group: 'Databases', label: c.name, hint: c.kind, icon: Database, run: go(`/db/${c.id}`) })
    }
    out.push(
      {
        id: 'live',
        group: 'Actions',
        label: live ? 'Turn live refresh off' : 'Turn live refresh on',
        icon: Lightning,
        run: toggle
      },
      {
        id: 'refresh',
        group: 'Actions',
        label: dbId ? 'Refresh this database now' : 'Refresh all databases now',
        icon: ArrowsClockwise,
        run: () => {
          api.analytics.refresh(dbId || undefined).then(
            () => toast('Snapshot taken'),
            (e: Error) => toast(e.message, 'error')
          )
        }
      },
      { id: 'add', group: 'Actions', label: 'Add connection', icon: Plus, run: openNew }
    )
    if (dbId) {
      for (const f of ['dbml', 'mermaid', 'json'] as const) {
        out.push({
          id: `export:${f}`,
          group: 'Actions',
          label: `Export schema as ${f === 'dbml' ? 'DBML' : f === 'mermaid' ? 'Mermaid' : 'JSON'}`,
          icon: DownloadSimple,
          run: () => runExport(api.exports.schema(dbId, f))
        })
      }
    }
    return out
  }, [navigate, dbId, schema.data, connections, live, toggle, openNew])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return commands
      .map((c) => ({ c, s: score(`${c.label} ${c.hint ?? ''}`, needle) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, 60)
      .map((x) => x.c)
  }, [commands, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (c: Command | undefined) => {
    if (!c) return
    setOpen(false)
    c.run()
  }

  let lastGroup = ''
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[55] flex items-start justify-center bg-ink-950/60 pt-[14vh] backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={() => setOpen(false)}
        >
          <motion.div
            className="w-[600px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900 shadow-2xl shadow-black/70"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b hairline px-4">
              <MagnifyingGlass size={15} className="text-zinc-500" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(a + 1, results.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    run(results[active])
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                }}
                placeholder={dbId ? 'Jump to a table, page or action…' : 'Jump to a database or action…'}
                className="h-12 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <kbd className="rounded border hairline px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">Esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {results.length === 0 && <p className="px-3 py-8 text-center text-xs text-zinc-600">No matches for “{q}”.</p>}
              {results.map((c, i) => {
                // ranked results interleave groups, so headers only make sense for the unfiltered list
                const header = !q.trim() && c.group !== lastGroup
                lastGroup = c.group
                const Ico = c.icon
                return (
                  <div key={c.id}>
                    {header && (
                      <p className="px-2.5 pt-2.5 pb-1 text-[10px] font-medium tracking-wide text-zinc-600 uppercase">{c.group}</p>
                    )}
                    <button
                      data-idx={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(c)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px]',
                        i === active ? 'bg-white/[0.06] text-zinc-50' : 'text-zinc-300'
                      )}
                    >
                      <Ico size={14} className={i === active ? 'text-accent' : 'text-zinc-500'} />
                      <span className="truncate">{c.label}</span>
                      {c.hint && <span className="ml-auto font-mono text-[10px] text-zinc-600">{c.hint}</span>}
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

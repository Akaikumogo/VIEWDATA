import {
  ArrowsClockwise,
  ArrowsOut,
  CircleNotch,
  Columns,
  Graph,
  Key,
  MagnifyingGlass,
  TreeStructure
} from '@phosphor-icons/react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler
} from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { NodePositions, SchemaInfo } from '@shared/types'
import { RelationEdge, type RelationFlowEdge } from '@/components/schema/RelationEdge'
import { TableNode, type TableFlowNode } from '@/components/schema/TableNode'
import { Button, ErrorState } from '@/components/ui'
import { cn } from '@/lib/format'
import { api, useSchema } from '@/lib/queries'
import {
  NODE_W,
  computeLayout,
  revealOrder,
  shapeOf,
  type FieldMode,
  type LayoutMode,
  type NodeShape
} from '@/lib/schemaLayout'

const nodeTypes = { table: TableNode }
const edgeTypes = { relation: RelationEdge }

const INTRO_MS = 1400
const STAGGER_MS = 28
const MAX_STAGGER_MS = 700

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

function bounds(pos: NodePositions, shapes: Map<string, NodeShape>) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [k, p] of Object.entries(pos)) {
    const h = shapes.get(k)?.height ?? 100
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x + NODE_W)
    y1 = Math.max(y1, p.y + h)
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 1, height: 1 }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function Canvas({ dbId, schema }: { dbId: string; schema: SchemaInfo }) {
  const rf = useReactFlow()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const focusParam = params.get('focus')

  const [fieldMode, setFieldMode] = useState<FieldMode>(schema.entities.length > 40 ? 'keys' : 'all')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('layered')
  const [nodes, setNodes, onNodesChange] = useNodesState<TableFlowNode>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [search, setSearch] = useState('')
  const [delays, setDelays] = useState<Map<string, number>>(new Map())
  const raf = useRef<number | null>(null)
  const introDone = useRef(false)

  const { entities, relations } = schema
  const shapes = useMemo(
    () => new Map(entities.map((e) => [e.name, shapeOf(e, relations, fieldMode)])),
    [entities, relations, fieldMode]
  )
  const order = useMemo(() => revealOrder(entities, relations), [entities, relations])
  const fkFields = useMemo(() => {
    const out = new Map<string, Set<string>>()
    const refs = new Map<string, Set<string>>()
    for (const r of relations) {
      out.set(r.from, (out.get(r.from) ?? new Set()).add(r.fromField))
      refs.set(r.to, (refs.get(r.to) ?? new Set()).add(r.toField))
    }
    return { out, refs }
  }, [relations])

  const animate = useCallback(
    (from: NodePositions, to: NodePositions, stagger: Map<string, number>, duration: number) =>
      new Promise<void>((resolve) => {
        if (raf.current) cancelAnimationFrame(raf.current)
        const t0 = performance.now()
        const maxDelay = Math.max(0, ...stagger.values())
        const step = (now: number) => {
          const elapsed = now - t0
          setNodes((ns) =>
            ns.map((n) => {
              const a = from[n.id] ?? to[n.id]
              const b = to[n.id]
              if (!a || !b) return n
              const t = easeOutExpo(Math.max(0, Math.min(1, (elapsed - (stagger.get(n.id) ?? 0)) / duration)))
              return { ...n, position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
            })
          )
          if (elapsed < duration + maxDelay) raf.current = requestAnimationFrame(step)
          else {
            raf.current = null
            resolve()
          }
        }
        raf.current = requestAnimationFrame(step)
      }),
    [setNodes]
  )

  const focusNode = useCallback(
    (name: string) => {
      const n = rf.getNode(name)
      if (!n) return
      const h = shapes.get(name)?.height ?? 200
      setSelected(name)
      rf.setCenter(n.position.x + NODE_W / 2, n.position.y + h / 2, { zoom: 1.05, duration: 900 })
    },
    [rf, shapes]
  )

  // Initial mount: lay out (or restore), then fly every table from the center to its spot
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBusy(true)
      const cached = await api.layout.get(dbId).catch(() => null)
      const complete = cached && entities.every((e) => cached[e.name])
      const target = complete ? cached! : await computeLayout(entities, relations, shapes, layoutMode)
      if (cancelled) return

      const b = bounds(target, shapes)
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      const stagger = new Map<string, number>()
      const start: NodePositions = {}
      for (const e of entities) {
        const rank = order.get(e.name) ?? 0
        stagger.set(e.name, Math.min(rank * STAGGER_MS, MAX_STAGGER_MS))
        const angle = rank * 2.399963
        const r = 18 * Math.sqrt(rank)
        start[e.name] = { x: cx - NODE_W / 2 + Math.cos(angle) * r, y: cy - 80 + Math.sin(angle) * r }
      }
      const edgeDelay = new Map<string, number>()
      for (const r of relations) {
        const d = Math.max(stagger.get(r.from) ?? 0, stagger.get(r.to) ?? 0)
        edgeDelay.set(r.id, (d + INTRO_MS * 0.45) / 1000)
      }
      setDelays(edgeDelay)

      setNodes(
        entities.map((e) => ({
          id: e.name,
          type: 'table',
          position: start[e.name],
          data: {
            entity: e,
            shape: shapes.get(e.name)!,
            fkFields: fkFields.out.get(e.name) ?? new Set(),
            refFields: fkFields.refs.get(e.name) ?? new Set(),
            delay: (stagger.get(e.name) ?? 0) / 1000,
            state: 'normal',
            highlightFields: new Set()
          }
        }))
      )

      requestAnimationFrame(() => {
        const vw = window.innerWidth - 288
        const vh = window.innerHeight - 40
        const fit = Math.min(vw / (b.width + 200), vh / (b.height + 200), 1.2)
        rf.setViewport({ x: vw / 2 - cx * fit * 2.2, y: vh / 2 - cy * fit * 2.2, zoom: fit * 2.2 })
        rf.fitBounds(b, { padding: 0.12, duration: INTRO_MS + 500 })
      })
      setBusy(false)
      await animate(start, target, stagger, INTRO_MS)
      introDone.current = true
      if (!cancelled && focusParam) focusNode(focusParam)
    })()
    return () => {
      cancelled = true
      if (raf.current) cancelAnimationFrame(raf.current)
    }
    // intro runs once per schema; layout/field mode changes go through relayout()
  }, [schema])

  const relayout = useCallback(
    async (lm: LayoutMode, fm: FieldMode) => {
      setBusy(true)
      const nextShapes = new Map(entities.map((e) => [e.name, shapeOf(e, relations, fm)]))
      const target = await computeLayout(entities, relations, nextShapes, lm)
      const from: NodePositions = {}
      for (const n of rf.getNodes()) from[n.id] = { ...n.position }
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, shape: nextShapes.get(n.id)! } })))
      rf.fitBounds(bounds(target, nextShapes), { padding: 0.12, duration: 1100 })
      setBusy(false)
      await animate(from, target, new Map(), 1000)
      api.layout.save(dbId, null)
    },
    [animate, dbId, entities, relations, rf, setNodes]
  )

  // Highlight the focused table, its neighbours and the rows taking part in each relation
  const focus = hovered ?? selected
  useEffect(() => {
    const related = new Set<string>()
    const lit = new Map<string, Set<string>>()
    const add = (t: string, f: string) => lit.set(t, (lit.get(t) ?? new Set()).add(f))
    if (focus) {
      for (const r of relations) {
        if (r.from === focus || r.to === focus) {
          related.add(r.from)
          related.add(r.to)
          add(r.from, r.fromField)
          add(r.to, r.toField)
        }
      }
    }
    setNodes((ns) =>
      ns.map((n) => {
        const state = !focus ? 'normal' : n.id === focus ? 'focus' : related.has(n.id) ? 'related' : 'dim'
        const highlightFields = lit.get(n.id) ?? new Set<string>()
        const same =
          n.data.highlightFields.size === highlightFields.size &&
          [...highlightFields].every((f) => n.data.highlightFields.has(f))
        if (n.data.state === state && same) return n
        return { ...n, data: { ...n.data, state, highlightFields } }
      })
    )
  }, [focus, relations, setNodes])

  const edges: RelationFlowEdge[] = useMemo(() => {
    const known = new Set(entities.map((e) => e.name))
    return relations
      .filter((r) => known.has(r.from) && known.has(r.to))
      .map((r) => ({
        id: r.id,
        source: r.to,
        target: r.from,
        type: 'relation' as const,
        selectable: false,
        data: {
          relation: r,
          parentShape: shapes.get(r.to)!,
          childShape: shapes.get(r.from)!,
          delay: delays.get(r.id) ?? 0,
          state: !focus ? ('normal' as const) : r.from === focus || r.to === focus ? ('active' as const) : ('dim' as const)
        }
      }))
  }, [entities, relations, shapes, delays, focus])

  const onDragStop = useCallback(() => {
    const pos: NodePositions = {}
    for (const n of rf.getNodes()) pos[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
    api.layout.save(dbId, pos)
  }, [dbId, rf])

  const onEnter: NodeMouseHandler<TableFlowNode> = useCallback((_, n) => setHovered(n.id), [])
  const onLeave: NodeMouseHandler<TableFlowNode> = useCallback(() => setHovered(null), [])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? entities.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 6) : []
  }, [search, entities])

  const segment = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
      active ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
    )

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeMouseEnter={onEnter}
        onNodeMouseLeave={onLeave}
        onNodeClick={(_, n) => setSelected((s) => (s === n.id ? null : n.id))}
        onNodeDoubleClick={(_, n) => navigate(`/db/${dbId}/table/${encodeURIComponent(n.id)}`)}
        onNodeDragStart={() => raf.current && cancelAnimationFrame(raf.current)}
        onNodeDragStop={onDragStop}
        onPaneClick={() => setSelected(null)}
        nodesConnectable={false}
        minZoom={0.08}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2a2a31" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => ((n.data as TableFlowNode['data']).state === 'focus' ? 'var(--color-accent)' : '#2a2a31')}
          nodeBorderRadius={6}
          maskColor="rgb(10 10 11 / 0.7)"
        />
        <Controls position="bottom-left" showInteractive={false} className="!mb-14" />
      </ReactFlow>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgb(10_10_11/0.85)_100%)]" />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.3 }}
        className="glass absolute top-4 left-4 flex items-center gap-3 rounded-xl p-1.5 pl-3.5"
      >
        <div className="pr-1">
          <p className="text-[13px] font-semibold tracking-tight text-zinc-100">Schema</p>
          <p className="font-mono text-[10.5px] text-zinc-500">
            {entities.length} tables · {relations.length} relations
          </p>
        </div>
        <div className="h-8 w-px bg-white/[0.07]" />
        <div className="flex gap-0.5 rounded-lg bg-ink-950/60 p-0.5">
          <button
            className={segment(layoutMode === 'layered')}
            onClick={() => {
              setLayoutMode('layered')
              relayout('layered', fieldMode)
            }}
          >
            <TreeStructure size={13} /> Hierarchy
          </button>
          <button
            className={segment(layoutMode === 'organic')}
            onClick={() => {
              setLayoutMode('organic')
              relayout('organic', fieldMode)
            }}
          >
            <Graph size={13} /> Organic
          </button>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-ink-950/60 p-0.5">
          <button
            className={segment(fieldMode === 'all')}
            onClick={() => {
              setFieldMode('all')
              relayout(layoutMode, 'all')
            }}
          >
            <Columns size={13} /> All columns
          </button>
          <button
            className={segment(fieldMode === 'keys')}
            onClick={() => {
              setFieldMode('keys')
              relayout(layoutMode, 'keys')
            }}
          >
            <Key size={13} /> Keys only
          </button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => relayout(layoutMode, fieldMode)} title="Recompute positions">
          <ArrowsClockwise size={13} className={cn(busy && 'animate-spin')} /> Re-layout
        </Button>
        <Button variant="ghost" size="sm" onClick={() => rf.fitView({ padding: 0.12, duration: 800 })} title="Fit to screen">
          <ArrowsOut size={13} />
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.4 }}
        className="absolute top-4 right-4 w-64"
      >
        <div className="glass relative rounded-xl">
          <MagnifyingGlass size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                focusNode(matches[0].name)
                setSearch('')
              }
            }}
            placeholder="Jump to table"
            className="h-9 w-full bg-transparent pr-3 pl-8 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
        <AnimatePresence>
          {matches.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="glass mt-1.5 overflow-hidden rounded-xl p-1"
            >
              {matches.map((m) => (
                <li key={m.name}>
                  <button
                    onClick={() => {
                      focusNode(m.name)
                      setSearch('')
                    }}
                    className="w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/[0.06]"
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="glass pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-5 rounded-full px-4 py-2 text-[11px] text-zinc-500">
        <span className="flex items-center gap-2">
          <svg width="22" height="6">
            <line x1="0" y1="3" x2="22" y2="3" stroke="rgb(255 255 255 / 0.35)" strokeWidth="1.2" />
          </svg>
          foreign key
        </span>
        <span className="flex items-center gap-2">
          <svg width="22" height="6">
            <line x1="0" y1="3" x2="22" y2="3" stroke="rgb(255 255 255 / 0.35)" strokeWidth="1.2" strokeDasharray="4 3" />
          </svg>
          inferred
        </span>
        <span>hover to trace · double-click to open</span>
      </div>

      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass absolute top-20 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-zinc-400"
          >
            <CircleNotch size={12} className="animate-spin text-accent" /> Computing layout
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SchemaView() {
  const { dbId = '' } = useParams()
  const { data, isLoading, isError, error, refetch } = useSchema(dbId)

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-14">
            <span className="breathe absolute inset-0 rounded-2xl border border-accent/40" />
            <span className="absolute inset-0 grid place-items-center rounded-2xl border hairline bg-ink-900">
              <Graph size={22} weight="duotone" className="text-accent" />
            </span>
          </div>
          <p className="text-sm text-zinc-400">Reading tables and relations…</p>
        </div>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="p-8">
        <ErrorState
          title="Could not read the schema"
          message={(error as Error)?.message ?? 'Unknown error'}
          action={
            <Button size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }
  if (data.entities.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="text-sm text-zinc-300">No tables to draw</p>
          <p className="mt-1 text-xs text-zinc-600">This database has no visible tables for the connected user.</p>
        </div>
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Canvas key={data.fetchedAt} dbId={dbId} schema={data} />
    </ReactFlowProvider>
  )
}

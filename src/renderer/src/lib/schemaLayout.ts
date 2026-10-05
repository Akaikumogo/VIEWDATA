import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { EntityMeta, FieldMeta, NodePositions, Relation } from '@shared/types'

export const NODE_W = 264
export const HEADER_H = 46
export const ROW_H = 26
export const FOOTER_H = 26

export type FieldMode = 'all' | 'keys'
export type LayoutMode = 'layered' | 'organic'

export interface NodeShape {
  fields: FieldMeta[]
  hidden: number
  height: number
}

const elk = new ELK()

/** Fields drawn inside a node; in "keys" mode only primary keys and relation columns stay visible */
export function shapeOf(entity: EntityMeta, relations: Relation[], mode: FieldMode): NodeShape {
  const all = entity.fields.filter((f) => !f.name.includes('.'))
  const relFields = new Set<string>()
  for (const r of relations) {
    if (r.from === entity.name) relFields.add(r.fromField)
    if (r.to === entity.name) relFields.add(r.toField)
  }
  const fields = mode === 'all' ? all : all.filter((f) => f.isPrimary || relFields.has(f.name))
  const hidden = all.length - fields.length
  return { fields, hidden, height: HEADER_H + fields.length * ROW_H + (hidden > 0 ? FOOTER_H : 0) + 6 }
}

export function rowIndex(shape: NodeShape, field: string): number {
  return shape.fields.findIndex((f) => f.name === field)
}

/** Vertical offset (inside the node) of a field row center, header center when the field is hidden */
export function rowCenter(shape: NodeShape, field: string): number {
  const i = rowIndex(shape, field)
  return i === -1 ? HEADER_H / 2 : HEADER_H + i * ROW_H + ROW_H / 2
}

export function degreeMap(entities: EntityMeta[], relations: Relation[]): Map<string, number> {
  const d = new Map(entities.map((e) => [e.name, 0]))
  for (const r of relations) {
    if (r.from === r.to) continue
    d.set(r.from, (d.get(r.from) ?? 0) + 1)
    d.set(r.to, (d.get(r.to) ?? 0) + 1)
  }
  return d
}

/**
 * Positions every table so related tables sit next to each other.
 *
 * - Referenced (parent) tables flow left-to-right into the tables that point at them,
 *   so hubs such as users or orders end up central with their dependents fanned out.
 * - Edges attach to the exact field rows via fixed ports, letting the crossing minimiser
 *   reorder nodes by which column they connect to rather than by node center.
 * - Tables without any relation are kept out of the graph and packed into a grid below it.
 */
export async function computeLayout(
  entities: EntityMeta[],
  relations: Relation[],
  shapes: Map<string, NodeShape>,
  mode: LayoutMode
): Promise<NodePositions> {
  const degree = degreeMap(entities, relations)
  const connected = entities.filter((e) => (degree.get(e.name) ?? 0) > 0)
  const isolated = entities.filter((e) => (degree.get(e.name) ?? 0) === 0)

  // Hubs first: ELK keeps model order as a tie-breaker, which pulls heavily referenced tables to the top
  connected.sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0) || a.name.localeCompare(b.name))

  const children: ElkNode[] = connected.map((e) => {
    const shape = shapes.get(e.name)!
    const ports = mode === 'layered'
      ? shape.fields.flatMap((f, i) => {
          const y = HEADER_H + i * ROW_H + ROW_H / 2
          return [
            { id: `${e.name}::${f.name}::w`, x: 0, y, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'WEST' } },
            { id: `${e.name}::${f.name}::e`, x: NODE_W - 1, y, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'EAST' } }
          ]
        })
      : []
    return {
      id: e.name,
      width: NODE_W,
      height: shape.height,
      ports,
      layoutOptions: (mode === 'layered' ? { 'elk.portConstraints': 'FIXED_POS' } : {}) as Record<string, string>
    }
  })

  const known = new Set(connected.map((e) => e.name))
  const edges: ElkExtendedEdge[] = []
  relations.forEach((r, i) => {
    if (r.from === r.to || !known.has(r.from) || !known.has(r.to)) return
    const parentShape = shapes.get(r.to)!
    const childShape = shapes.get(r.from)!
    const usePorts = mode === 'layered' && rowIndex(parentShape, r.toField) >= 0 && rowIndex(childShape, r.fromField) >= 0
    edges.push({
      id: `e${i}`,
      sources: [usePorts ? `${r.to}::${r.toField}::e` : r.to],
      targets: [usePorts ? `${r.from}::${r.fromField}::w` : r.from]
    })
  })

  const layoutOptions: Record<string, string> =
    mode === 'layered'
      ? {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.layered.spacing.nodeNodeBetweenLayers': '150',
          'elk.spacing.nodeNode': '44',
          'elk.spacing.edgeNode': '24',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
          'elk.layered.cycleBreaking.strategy': 'GREEDY',
          'elk.separateConnectedComponents': 'true',
          'elk.spacing.componentComponent': '110',
          'elk.aspectRatio': '1.7'
        }
      : {
          'elk.algorithm': 'stress',
          'elk.stress.desiredEdgeLength': '360',
          'elk.stress.epsilon': '0.0001',
          'elk.stress.iterationLimit': '600'
        }

  const positions: NodePositions = {}
  let maxY = 0
  let minX = 0
  if (children.length) {
    const res = await elk.layout({ id: 'root', layoutOptions, children, edges })
    for (const c of res.children ?? []) {
      positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 }
      maxY = Math.max(maxY, (c.y ?? 0) + (c.height ?? 0))
      minX = Math.min(minX, c.x ?? 0)
    }
    if (mode === 'organic') removeOverlaps(positions, shapes)
    maxY = Math.max(...Object.entries(positions).map(([k, p]) => p.y + shapes.get(k)!.height))
    minX = Math.min(...Object.values(positions).map((p) => p.x))
  }

  if (isolated.length) {
    const cols = Math.max(3, Math.ceil(Math.sqrt(isolated.length * 1.6)))
    const gapX = 48
    const gapY = 40
    let y = children.length ? maxY + 160 : 0
    for (let i = 0; i < isolated.length; i += cols) {
      const rowItems = isolated.slice(i, i + cols)
      const rowH = Math.max(...rowItems.map((e) => shapes.get(e.name)!.height))
      rowItems.forEach((e, j) => {
        positions[e.name] = { x: minX + j * (NODE_W + gapX), y }
      })
      y += rowH + gapY
    }
  }
  return positions
}

/** Stress layout ignores node size; push apart any boxes that still overlap */
function removeOverlaps(pos: NodePositions, shapes: Map<string, NodeShape>): void {
  const ids = Object.keys(pos)
  const pad = 36
  for (let iter = 0; iter < 80; iter++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]]
        const b = pos[ids[j]]
        const ah = shapes.get(ids[i])!.height
        const bh = shapes.get(ids[j])!.height
        const ox = Math.min(a.x + NODE_W + pad, b.x + NODE_W + pad) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + ah + pad, b.y + bh + pad) - Math.max(a.y, b.y)
        if (ox > 0 && oy > 0) {
          moved = true
          if (ox < oy) {
            const s = (a.x < b.x ? -1 : 1) * (ox / 2)
            a.x += s
            b.x -= s
          } else {
            const s = (a.y < b.y ? -1 : 1) * (oy / 2)
            a.y += s
            b.y -= s
          }
        }
      }
    }
    if (!moved) break
  }
}

/** Order in which nodes appear during the intro: hubs first, then outward by graph distance */
export function revealOrder(entities: EntityMeta[], relations: Relation[]): Map<string, number> {
  const degree = degreeMap(entities, relations)
  const adj = new Map<string, Set<string>>(entities.map((e) => [e.name, new Set()]))
  for (const r of relations) {
    adj.get(r.from)?.add(r.to)
    adj.get(r.to)?.add(r.from)
  }
  const order = new Map<string, number>()
  const byDegree = [...entities].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0))
  let rank = 0
  for (const start of byDegree) {
    if (order.has(start.name)) continue
    const queue = [start.name]
    order.set(start.name, rank++)
    while (queue.length) {
      const cur = queue.shift()!
      const next = [...(adj.get(cur) ?? [])].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
      for (const n of next) {
        if (!order.has(n)) {
          order.set(n, rank++)
          queue.push(n)
        }
      }
    }
  }
  return order
}

import { useInternalNode, type Edge, type EdgeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { memo } from 'react'
import type { Relation } from '@shared/types'
import { NODE_W, rowCenter, type NodeShape } from '@/lib/schemaLayout'

export type RelationEdgeData = {
  relation: Relation
  parentShape: NodeShape
  childShape: NodeShape
  delay: number
  state: 'normal' | 'active' | 'dim'
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

/**
 * Floating edge: anchors to the referenced row on the parent and the FK row on the child,
 * picking left or right sides from the live node positions so it stays clean while dragging.
 */
function buildPath(
  px: number,
  py: number,
  cx: number,
  cy: number,
  parentY: number,
  childY: number,
  selfLoop: boolean
): { d: string; start: [number, number]; end: [number, number] } {
  if (selfLoop) {
    const x = px + NODE_W
    const sy = py + parentY
    const ey = cy + childY
    const bulge = 46 + Math.abs(ey - sy) * 0.15
    return {
      d: `M${x},${sy} C${x + bulge},${sy} ${x + bulge},${ey} ${x},${ey}`,
      start: [x, sy],
      end: [x, ey]
    }
  }
  const parentCenter = px + NODE_W / 2
  const childCenter = cx + NODE_W / 2
  const childRight = childCenter >= parentCenter
  let sx: number
  let ex: number
  let dirS: number
  let dirE: number
  if (Math.abs(childCenter - parentCenter) < NODE_W * 0.6) {
    // stacked vertically: route both ends out of the right side
    sx = px + NODE_W
    ex = cx + NODE_W
    dirS = 1
    dirE = 1
  } else if (childRight) {
    sx = px + NODE_W
    ex = cx
    dirS = 1
    dirE = -1
  } else {
    sx = px
    ex = cx + NODE_W
    dirS = -1
    dirE = 1
  }
  const sy = py + parentY
  const ey = cy + childY
  const k = Math.max(60, Math.min(220, Math.abs(ex - sx) * 0.5 + (dirS === dirE ? 50 : 0)))
  return {
    d: `M${sx},${sy} C${sx + dirS * k},${sy} ${ex + dirE * k},${ey} ${ex},${ey}`,
    start: [sx, sy],
    end: [ex, ey]
  }
}

export const RelationEdge = memo(function RelationEdge({ id, source, target, data }: EdgeProps<RelationFlowEdge>) {
  const parent = useInternalNode(source)
  const child = useInternalNode(target)
  if (!parent || !child || !data) return null

  const p = parent.internals.positionAbsolute
  const c = child.internals.positionAbsolute
  const { relation, parentShape, childShape, delay, state } = data
  const { d, start, end } = buildPath(
    p.x,
    p.y,
    c.x,
    c.y,
    rowCenter(parentShape, relation.toField),
    rowCenter(childShape, relation.fromField),
    source === target
  )
  const inferred = relation.confidence < 1
  const active = state === 'active'
  const stroke = active ? 'var(--color-accent)' : 'rgb(255 255 255 / 0.26)'

  return (
    <g style={{ opacity: state === 'dim' ? 0.07 : 1, transition: 'opacity 0.4s cubic-bezier(0.16,1,0.3,1)' }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      {inferred ? (
        <motion.path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={active ? 1.6 : 1.2}
          strokeDasharray="5 5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay, duration: 0.8 }}
        />
      ) : (
        <motion.path
          id={id}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={active ? 1.6 : 1.2}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ pathLength: { delay, duration: 1.1, ease: [0.16, 1, 0.3, 1] }, opacity: { delay, duration: 0.2 } }}
        />
      )}
      {active && (
        <>
          <path
            d={d}
            fill="none"
            stroke="var(--color-accent)"
            strokeOpacity="0.5"
            strokeWidth={1.6}
            strokeDasharray="2 10"
            style={{ animation: 'dash-flow 0.9s linear infinite' }}
          />
          <circle r="2.6" fill="var(--color-accent)">
            <animateMotion dur="1.8s" repeatCount="indefinite" path={d} />
          </circle>
        </>
      )}
      <motion.circle
        cx={start[0]}
        cy={start[1]}
        r={3}
        fill="#111114"
        stroke={stroke}
        strokeWidth={1.2}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: delay + 0.2, type: 'spring', stiffness: 300, damping: 18 }}
      />
      <motion.circle
        cx={end[0]}
        cy={end[1]}
        r={2.6}
        fill={stroke}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: delay + 0.9, type: 'spring', stiffness: 300, damping: 18 }}
      />
    </g>
  )
})

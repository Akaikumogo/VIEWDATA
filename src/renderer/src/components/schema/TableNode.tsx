import { Eye, Key, LinkSimple, Table } from '@phosphor-icons/react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { memo } from 'react'
import type { EntityMeta } from '@shared/types'
import { cn, formatCount } from '@/lib/format'
import { FOOTER_H, HEADER_H, NODE_W, ROW_H, type NodeShape } from '@/lib/schemaLayout'

export type TableNodeData = {
  entity: EntityMeta
  shape: NodeShape
  fkFields: Set<string>
  refFields: Set<string>
  delay: number
  state: 'normal' | 'focus' | 'related' | 'dim'
  highlightFields: Set<string>
}

export type TableFlowNode = Node<TableNodeData, 'table'>

const spring = { type: 'spring' as const, stiffness: 120, damping: 18 }

export const TableNode = memo(function TableNode({ data }: NodeProps<TableFlowNode>) {
  const { entity, shape, fkFields, refFields, delay, state, highlightFields } = data
  const Icon = entity.kind === 'view' ? Eye : Table
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.82, filter: 'blur(12px)' }}
      animate={{ opacity: state === 'dim' ? 0.22 : 1, scale: 1, filter: 'blur(0px)' }}
      transition={{
        opacity: { duration: 0.35, delay: state === 'normal' ? delay : 0 },
        scale: { ...spring, delay },
        filter: { duration: 0.6, delay }
      }}
      style={{ width: NODE_W, height: shape.height }}
      className={cn(
        'overflow-hidden rounded-xl border bg-ink-900/95 transition-[border-color,box-shadow] duration-300',
        state === 'focus'
          ? 'border-accent/60 shadow-[0_0_0_1px_var(--color-accent-dim),0_24px_60px_-20px_rgb(0_0_0/0.9)]'
          : state === 'related'
            ? 'border-accent/25 shadow-[0_20px_50px_-24px_rgb(0_0_0/0.9)]'
            : 'border-white/[0.08] shadow-[0_16px_40px_-24px_rgb(0_0_0/0.8)]'
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <div
        style={{ height: HEADER_H }}
        className={cn(
          'flex items-center gap-2.5 border-b px-3.5',
          state === 'focus' ? 'border-accent/20 bg-accent/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
        )}
      >
        <Icon size={14} weight="duotone" className={state === 'focus' ? 'text-accent' : 'text-zinc-500'} />
        <span className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">{entity.name}</span>
        <span className="ml-auto font-mono text-[10.5px] text-zinc-500">{formatCount(entity.rowCount)}</span>
      </div>
      <div className="py-[3px]">
        {shape.fields.map((f) => {
          const isFk = fkFields.has(f.name)
          const isRef = refFields.has(f.name)
          const lit = highlightFields.has(f.name)
          return (
            <div
              key={f.name}
              style={{ height: ROW_H }}
              className={cn(
                'flex items-center gap-2 px-3.5 text-[12px] transition-colors duration-300',
                lit && 'bg-accent/[0.08]'
              )}
            >
              <span className="grid w-3 place-items-center">
                {f.isPrimary ? (
                  <Key size={10} weight="fill" className="text-warn" />
                ) : isFk ? (
                  <LinkSimple size={10} weight="bold" className="text-accent" />
                ) : (
                  <span className="size-1 rounded-full bg-zinc-700" />
                )}
              </span>
              <span
                className={cn(
                  'truncate',
                  lit ? 'text-accent' : f.isPrimary || isFk || isRef ? 'text-zinc-200' : 'text-zinc-400'
                )}
              >
                {f.name}
              </span>
              <span className="ml-auto max-w-[96px] truncate font-mono text-[10px] text-zinc-600">{f.type}</span>
            </div>
          )
        })}
        {shape.hidden > 0 && (
          <div style={{ height: FOOTER_H }} className="flex items-center px-3.5 font-mono text-[10.5px] text-zinc-600">
            + {shape.hidden} more column{shape.hidden === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </motion.div>
  )
})

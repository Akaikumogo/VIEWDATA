import { BracketsCurly } from '@phosphor-icons/react'
import { memo } from 'react'
import type { CellValue } from '@shared/types'
import { cn } from '@/lib/format'
import { useDrawer } from '@/stores/drawer'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function keyString(v: CellValue): string {
  if (v === null) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export const PlainCell = memo(function PlainCell({ value, field }: { value: CellValue; field: string }) {
  const open = useDrawer((s) => s.open)
  if (value === null) return <span className="text-[11px] text-zinc-700 italic">NULL</span>
  if (typeof value === 'boolean')
    return <span className={cn('font-mono text-xs', value ? 'text-accent' : 'text-zinc-500')}>{String(value)}</span>
  if (typeof value === 'number') return <span className="font-mono text-xs text-zinc-300 tabular-nums">{value}</span>
  if (typeof value === 'object') {
    const n = Array.isArray(value) ? value.length : Object.keys(value).length
    return (
      <button
        onClick={() => open({ type: 'json', title: field, value })}
        className="inline-flex items-center gap-1.5 rounded-md border hairline bg-white/[0.02] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 hover:border-accent/30 hover:text-accent"
      >
        <BracketsCurly size={11} />
        {Array.isArray(value) ? `${n} items` : `${n} keys`}
      </button>
    )
  }
  if (ISO_DATE.test(value)) return <span className="font-mono text-xs text-zinc-400">{value.replace('T', ' ').slice(0, 19)}</span>
  return (
    <span className="block max-w-[340px] truncate text-[13px] text-zinc-300" title={value.length > 40 ? value : undefined}>
      {value}
    </span>
  )
})

import { WarningCircle } from '@phosphor-icons/react'
import { memo, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { KIND_SHORT, type DbKind, type Snapshot } from '@shared/types'
import { cn } from '@/lib/format'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={cn(
        'no-drag inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
        'transition-[transform,background-color,border-color,color] duration-200 ease-[var(--ease-out-expo)]',
        'active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-accent text-ink-950 hover:bg-[oklch(0.86_0.1_168)]',
        variant === 'outline' &&
          'border border-white/[0.08] bg-white/[0.02] text-zinc-200 hover:border-white/[0.14] hover:bg-white/[0.05]',
        variant === 'ghost' && 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
        variant === 'danger' && 'border border-danger/30 text-danger hover:bg-danger/10',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-md', className)} />
}

export function KindBadge({ kind, className }: { kind: DbKind; className?: string }) {
  return (
    <span
      className={cn(
        'inline-grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-ink-850',
        'font-mono text-[10px] font-semibold tracking-wider text-zinc-300',
        className
      )}
    >
      {KIND_SHORT[kind]}
    </span>
  )
}

export const StatusDot = memo(function StatusDot({ snapshot }: { snapshot?: Snapshot }) {
  const state = !snapshot ? 'idle' : snapshot.status === 'ok' ? 'ok' : 'error'
  const color = state === 'ok' ? 'bg-accent' : state === 'error' ? 'bg-danger' : 'bg-zinc-600'
  return <span className={cn('inline-flex size-2 shrink-0 rounded-full', color)} title={snapshot?.error ?? state} />
})

/** Small dropdown menu anchored to its trigger; closes on outside click and Escape */
export function Menu({
  label,
  items,
  align = 'right',
  disabled
}: {
  label: ReactNode
  items: { label: string; hint?: string; onSelect: () => void }[]
  align?: 'left' | 'right'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {label}
      </Button>
      {open && (
        <div
          className={cn(
            'absolute top-full z-40 mt-1 min-w-[200px] rounded-xl border border-white/[0.08] bg-ink-900 p-1 shadow-2xl shadow-black/60',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
              className="flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.05] hover:text-zinc-50"
            >
              {it.label}
              {it.hint && <span className="font-mono text-[10px] text-zinc-600">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-zinc-300 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-accent/40 bg-accent/80' : 'border-white/[0.1] bg-white/[0.04]'
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] size-3 rounded-full transition-[left,background-color] duration-200 ease-[var(--ease-out-expo)]',
            checked ? 'left-[16px] bg-ink-950' : 'left-[2px] bg-zinc-400'
          )}
        />
      </button>
      {label}
    </label>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-white/[0.07] px-6 py-10 text-center">
      <p className="text-sm text-zinc-300">{title}</p>
      {hint && <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-zinc-600">{hint}</p>}
    </div>
  )
}

export function Sparkline({
  values,
  className,
  height = 28
}: {
  values: number[]
  className?: string
  height?: number
}) {
  const w = 100
  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={className}>
        <line x1="0" x2={w} y1={height / 2} y2={height / 2} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="2 3" />
      </svg>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function AreaChart({
  points,
  height = 180,
  format
}: {
  points: { t: number; v: number }[]
  height?: number
  format: (v: number) => string
}) {
  const w = 600
  if (points.length < 2) {
    return (
      <div style={{ height }} className="grid place-items-center rounded-xl border border-dashed border-white/[0.07]">
        <p className="max-w-[36ch] text-center text-xs leading-relaxed text-zinc-500">
          History builds up as snapshots are taken every 15 minutes. Refresh to capture another point now.
        </p>
      </div>
    )
  }
  const vs = points.map((p) => p.v)
  const min = Math.min(...vs) * 0.96
  const max = Math.max(...vs) * 1.02 || 1
  const t0 = points[0].t
  const t1 = points[points.length - 1].t || t0 + 1
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w
  const y = (v: number) => height - 8 - ((v - min) / (max - min || 1)) * (height - 24)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${w},${height} L0,${height} Z`
  const last = points[points.length - 1]
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} stroke="white" strokeOpacity="0.04" />
        ))}
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div
        className="pointer-events-none absolute -translate-x-full -translate-y-1/2 pr-2 font-mono text-[11px] text-accent"
        style={{ left: '100%', top: y(last.v) }}
      >
        {format(last.v)}
      </div>
    </div>
  )
}

export function ErrorState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/[0.04] p-4">
      <WarningCircle size={18} weight="duotone" className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <p className="mt-1 font-mono text-xs leading-relaxed break-words text-zinc-400">{message}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  className
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-2 truncate font-mono text-2xl font-medium tracking-tight text-zinc-50">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}

import { BellSimple, Plus, X } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { AlertKind, AlertRule } from '@shared/types'
import { cn, timeAgo } from '@/lib/format'
import { api, qk, useAlerts } from '@/lib/queries'
import { toast } from '@/stores/toast'
import { Button } from './ui'

const KIND_TEXT: Record<AlertKind, string> = {
  offline: 'Connection fails',
  size_gt: 'Size is above',
  growth_pct: 'Grows in 24h by more than'
}

function ruleText(r: AlertRule): string {
  if (r.kind === 'offline') return KIND_TEXT.offline
  return `${KIND_TEXT[r.kind]} ${r.threshold}${r.kind === 'size_gt' ? ' MB' : '%'}`
}

const inputCls =
  'h-7 rounded-md border border-white/[0.08] bg-ink-900 px-2 text-xs text-zinc-200 outline-none focus:border-accent/40'

export function AlertsPanel({ dbId }: { dbId: string }) {
  const qc = useQueryClient()
  const { data } = useAlerts(dbId)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<AlertKind>('offline')
  const [threshold, setThreshold] = useState('')

  const refresh = () => qc.invalidateQueries({ queryKey: qk.alerts(dbId) })
  const add = async () => {
    try {
      await api.alerts.add(dbId, kind, Number(threshold))
      setAdding(false)
      setThreshold('')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Alerts</h2>
          <p className="mt-0.5 text-xs text-zinc-600">checked after every snapshot · Windows notification</p>
        </div>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus size={12} /> Rule
          </Button>
        )}
      </div>

      {adding && (
        <form
          className="mt-3 flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
            {(Object.keys(KIND_TEXT) as AlertKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_TEXT[k]}
              </option>
            ))}
          </select>
          {kind !== 'offline' && (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                type="number"
                min="0"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={cn(inputCls, 'w-20 font-mono')}
              />
              <span className="text-xs text-zinc-500">{kind === 'size_gt' ? 'MB' : '%'}</span>
            </span>
          )}
          <Button size="sm" variant="primary" type="submit">
            Add
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}

      <ul className="mt-3 space-y-1">
        {data?.rules.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-zinc-300 hover:bg-white/[0.03]">
            <BellSimple size={13} className="text-accent/80" />
            {ruleText(r)}
            <button
              onClick={async () => {
                await api.alerts.remove(r.id)
                refresh()
              }}
              className="ml-auto text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-zinc-300"
              title="Remove rule"
            >
              <X size={11} />
            </button>
          </li>
        ))}
        {data && !data.rules.length && !adding && (
          <li className="py-2 text-xs text-zinc-600">No rules yet. Add one to get notified when something goes wrong.</li>
        )}
      </ul>

      {!!data?.events.length && (
        <div className="mt-4 border-t hairline pt-3">
          <p className="mb-1.5 text-[10.5px] font-medium tracking-wide text-zinc-600 uppercase">Recent</p>
          <ul className="space-y-1">
            {data.events.slice(0, 5).map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                <span className="min-w-0 flex-1 text-zinc-400">{e.message}</span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">{timeAgo(e.firedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

import { ArrowLeft, ArrowSquareOut, CaretRight, Key, LinkSimple, LockSimple, PencilSimple, X } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type CellValue, type FieldMeta, writesAllowed } from '@shared/types'
import { filteredTableUrl } from '@/lib/filters'
import { cn, formatExact } from '@/lib/format'
import { api, useConnectionDetail, useRecord } from '@/lib/queries'
import { useDrawer, type DrawerEntry } from '@/stores/drawer'
import { toast } from '@/stores/toast'
import { keyString } from './cells'
import { Button, ErrorState, Skeleton } from './ui'

function JsonTree({ value, depth = 0 }: { value: CellValue; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  if (value === null) return <span className="text-zinc-600 italic">null</span>
  if (typeof value === 'string') return <span className="break-all text-[oklch(0.82_0.08_140)]">"{value}"</span>
  if (typeof value === 'number') return <span className="text-[oklch(0.82_0.09_250)]">{value}</span>
  if (typeof value === 'boolean') return <span className="text-warn">{String(value)}</span>
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const [l, r] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  if (!entries.length) return <span className="text-zinc-500">{l + r}</span>
  return (
    <span>
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center text-zinc-500 hover:text-zinc-200">
        <CaretRight size={9} weight="bold" className={cn('mr-0.5 transition-transform', open && 'rotate-90')} />
        {l}
        {!open && <span className="px-1 text-zinc-600">{entries.length}…</span>}
        {!open && r}
      </button>
      {open && (
        <>
          <div className="ml-3 border-l hairline pl-3">
            {entries.map(([k, v]) => (
              <div key={k} className="leading-6">
                <span className="text-zinc-400">{k}</span>
                <span className="text-zinc-700">: </span>
                <JsonTree value={v} depth={depth + 1} />
              </div>
            ))}
          </div>
          <span className="text-zinc-500">{r}</span>
        </>
      )}
    </span>
  )
}

function renderValue(v: CellValue) {
  if (v === null) return <span className="text-zinc-700 italic">NULL</span>
  if (typeof v === 'object')
    return (
      <div className="font-mono text-[11.5px]">
        <JsonTree value={v} />
      </div>
    )
  if (typeof v === 'number' || typeof v === 'boolean') return <span className="font-mono text-zinc-200">{String(v)}</span>
  return <span className="break-words whitespace-pre-wrap text-zinc-200">{v}</span>
}

type RecordEntry = Extract<DrawerEntry, { type: 'record' }>

function toDraft(v: CellValue): string {
  if (v === null) return ''
  return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
}

/** Converts edited text back to a value of the same shape as the original */
function fromDraft(text: string, original: CellValue, isNull: boolean): CellValue {
  if (isNull) return null
  if (typeof original === 'number') {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) throw new Error(`"${text}" is not a number`)
    return n
  }
  if (typeof original === 'boolean') return text === 'true' || text === '1'
  if (original !== null && typeof original === 'object') return JSON.parse(text) as CellValue
  return text
}

function EditForm({
  entry,
  row,
  fields,
  onDone
}: {
  entry: RecordEntry
  row: Record<string, CellValue>
  fields: FieldMeta[]
  onDone: (saved: boolean) => void
}) {
  const editable = Object.keys(row).filter((k) => k !== entry.key)
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((k) => [k, toDraft(row[k] ?? null)]))
  )
  const [nulls, setNulls] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(editable.map((k) => [k, row[k] === null]))
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setErr(null)
    const changes: Record<string, CellValue> = {}
    try {
      for (const k of editable) {
        const orig = row[k] ?? null
        const unchanged = nulls[k] === (orig === null) && (nulls[k] || draft[k] === toDraft(orig))
        if (unchanged) continue
        changes[k] = fromDraft(draft[k], orig, nulls[k])
      }
    } catch (e) {
      setErr((e as Error).message)
      return
    }
    if (!Object.keys(changes).length) return onDone(false)
    setSaving(true)
    try {
      const n = await api.rows.update(entry.connectionId, entry.entity, entry.key, entry.value, changes)
      toast(n ? `Updated ${Object.keys(changes).length} field${Object.keys(changes).length > 1 ? 's' : ''}` : 'No row was changed')
      onDone(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b hairline px-6 py-4">
        <div>
          <p className="font-mono text-[11px] text-accent">{entry.entity}</p>
          <p className="mt-0.5 text-sm text-zinc-200">
            Editing {entry.key} = <span className="font-mono">{entry.value}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {err && (
        <div className="px-6 pt-4">
          <ErrorState title="Could not save" message={err} />
        </div>
      )}
      <div className="space-y-3 px-6 py-5">
        {editable.map((k) => {
          const meta = fields.find((f) => f.name === k)
          const orig = row[k] ?? null
          const multiline = orig !== null && typeof orig === 'object'
          const cls =
            'w-full rounded-lg border border-white/[0.08] bg-ink-950 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent/40 disabled:opacity-40'
          return (
            <div key={k}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  {k} <span className="font-mono text-[10px] text-zinc-700">{meta?.type}</span>
                </span>
                {(meta?.nullable ?? true) && (
                  <label className="flex items-center gap-1 text-[10px] text-zinc-600">
                    <input
                      type="checkbox"
                      checked={nulls[k]}
                      onChange={(e) => setNulls((s) => ({ ...s, [k]: e.target.checked }))}
                      className="accent-[var(--color-accent)]"
                    />
                    NULL
                  </label>
                )}
              </div>
              {multiline ? (
                <textarea
                  rows={5}
                  value={draft[k]}
                  disabled={nulls[k]}
                  onChange={(e) => setDraft((s) => ({ ...s, [k]: e.target.value }))}
                  className={cls}
                />
              ) : (
                <input
                  value={draft[k]}
                  disabled={nulls[k]}
                  onChange={(e) => setDraft((s) => ({ ...s, [k]: e.target.value }))}
                  className={cls}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecordBody({ entry }: { entry: RecordEntry }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { push, close } = useDrawer()
  const { data, isLoading, isError, error } = useRecord(entry.connectionId, entry.entity, entry.key, entry.value)
  const detail = useConnectionDetail(entry.connectionId)
  const canWrite = !!detail.data && writesAllowed(detail.data.connection)
  const [editing, setEditing] = useState(false)
  const fkByField = new Map((data?.outgoing ?? []).map((o) => [o.relation.fromField, o]))

  const changeDisplay = async (field: string) => {
    await api.display.set(entry.connectionId, entry.entity, field)
    qc.invalidateQueries({ queryKey: ['rows', entry.connectionId] })
    qc.invalidateQueries({ queryKey: ['record', entry.connectionId] })
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <div className="space-y-2 pt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="p-6">
        <ErrorState title="Could not load this record" message={(error as Error).message} />
      </div>
    )
  }
  if (!data?.row) {
    return (
      <div className="p-6">
        <p className="text-sm text-zinc-300">No row in {entry.entity} has {entry.key} = {entry.value}.</p>
        <p className="mt-1 text-xs text-zinc-600">The reference may be dangling or the row was deleted.</p>
      </div>
    )
  }

  const row = data.row
  const title = data.displayField && row[data.displayField] != null ? String(row[data.displayField]) : `${entry.key} ${entry.value}`
  const textFields = data.fields.filter((f) => !f.isPrimary)

  if (editing) {
    return (
      <EditForm
        entry={entry}
        row={row}
        fields={data.fields}
        onDone={(saved) => {
          setEditing(false)
          if (saved) {
            qc.invalidateQueries({ queryKey: ['rows', entry.connectionId] })
            qc.invalidateQueries({ queryKey: ['record', entry.connectionId] })
          }
        }}
      />
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b hairline px-6 pt-5 pb-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-accent">{entry.entity}</p>
          {canWrite ? (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-md border hairline px-2 py-0.5 text-[11px] text-zinc-400 hover:border-accent/30 hover:text-accent"
            >
              <PencilSimple size={11} /> Edit
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-600" title="Enable 'Allow writes' in the connection settings to edit rows">
              <LockSimple size={10} /> read-only
            </span>
          )}
        </div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight break-words text-zinc-50">{title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <Key size={11} weight="fill" className="text-warn" />
            <span className="font-mono text-zinc-400">
              {entry.key} = {entry.value}
            </span>
          </span>
          <label className="inline-flex items-center gap-1.5">
            Label column
            <select
              value={data.displayField ?? ''}
              onChange={(e) => changeDisplay(e.target.value)}
              className="rounded-md border hairline bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-accent/40"
            >
              {!data.displayField && <option value="">none</option>}
              {textFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <dl className="divide-y divide-white/[0.04]">
        {Object.entries(row).map(([k, v], i) => {
          const fk = fkByField.get(k)
          const meta = data.fields.find((f) => f.name === k)
          return (
            <motion.div
              key={k}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.3), type: 'spring', stiffness: 260, damping: 26 }}
              className="grid grid-cols-[150px_1fr] gap-4 px-6 py-2.5 text-[13px]"
            >
              <dt className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-zinc-400">
                  {meta?.isPrimary && <Key size={10} weight="fill" className="text-warn" />}
                  {fk && <LinkSimple size={10} weight="bold" className="text-accent" />}
                  {k}
                </span>
                {meta && <span className="font-mono text-[10px] text-zinc-700">{meta.type}</span>}
              </dt>
              <dd className="min-w-0">
                {fk ? (
                  <button
                    onClick={() =>
                      push({
                        type: 'record',
                        connectionId: entry.connectionId,
                        entity: fk.relation.to,
                        key: fk.relation.toField,
                        value: fk.value
                      })
                    }
                    className="group inline-flex max-w-full items-stretch overflow-hidden rounded-md border border-accent/20 text-left"
                  >
                    <span className="bg-white/[0.03] px-2 py-0.5 font-mono text-xs text-zinc-400">{fk.value}</span>
                    <span className="flex items-center gap-1 truncate px-2 py-0.5 text-accent group-hover:bg-accent-dim">
                      {fk.label ?? fk.relation.to}
                      <CaretRight size={10} weight="bold" />
                    </span>
                  </button>
                ) : (
                  renderValue(v)
                )}
              </dd>
            </motion.div>
          )
        })}
      </dl>

      {data.incoming.length > 0 && (
        <div className="border-t hairline px-6 py-5">
          <h3 className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Referenced by</h3>
          <ul className="mt-3 space-y-1">
            {data.incoming.map(({ relation, count }) => (
              <li key={relation.id}>
                <button
                  onClick={() => {
                    close()
                    navigate(
                      filteredTableUrl(entry.connectionId, relation.from, [
                        { field: relation.fromField, op: 'eq', value: keyString(row[relation.toField] ?? entry.value) }
                      ])
                    )
                  }}
                  className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04]"
                >
                  <span className="truncate text-[13px] text-zinc-300">
                    {relation.from}
                    <span className="font-mono text-[11px] text-zinc-600">.{relation.fromField}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn('font-mono text-xs', count ? 'text-accent' : 'text-zinc-600')}>
                      {count === null ? '?' : formatExact(count)}
                    </span>
                    <ArrowSquareOut size={12} className="text-zinc-700 group-hover:text-zinc-300" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function crumbLabel(e: DrawerEntry): string {
  return e.type === 'json' ? e.title : `${e.entity}:${e.value}`
}

export function RecordDrawer() {
  const { stack, back, jump, close } = useDrawer()
  const top = stack[stack.length - 1]

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <AnimatePresence>
      {top && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 top-10 z-30 bg-ink-950/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.aside
            key="drawer"
            className="glass fixed top-10 right-0 bottom-0 z-40 flex w-[520px] max-w-[92vw] flex-col rounded-l-2xl border-r-0"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b hairline px-3">
              <button
                onClick={back}
                disabled={stack.length < 2}
                className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-25"
                aria-label="Back"
              >
                <ArrowLeft size={13} />
              </button>
              <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[11px]">
                {stack.map((e, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <CaretRight size={9} className="shrink-0 text-zinc-700" />}
                    <button
                      onClick={() => jump(i)}
                      className={cn(
                        'truncate rounded px-1 font-mono',
                        i === stack.length - 1 ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
                      )}
                    >
                      {crumbLabel(e)}
                    </button>
                  </span>
                ))}
              </nav>
              <button
                onClick={close}
                className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={stack.length + crumbLabel(top)}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  {top.type === 'record' ? (
                    <RecordBody entry={top} />
                  ) : (
                    <div className="p-6">
                      <p className="font-mono text-[11px] text-accent">{top.title}</p>
                      <div className="mt-4 font-mono text-xs">
                        <JsonTree value={top.value} />
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

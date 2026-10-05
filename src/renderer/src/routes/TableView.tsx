import {
  ArrowDown,
  ArrowUp,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  FunnelSimple,
  Graph,
  Key,
  LinkSimple,
  Plus,
  X
} from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { FILTER_LABEL, type CellValue, type FieldMeta, type FilterOp, type FkColumn, type Row, type RowFilter, type RowsQuery } from '@shared/types'
import { PlainCell, keyString } from '@/components/cells'
import { Button, ErrorState, Menu, Skeleton, Sparkline } from '@/components/ui'
import { decodeFilter, encodeFilter, needsValue } from '@/lib/filters'
import { cn, formatCount, formatExact } from '@/lib/format'
import { api, useConnectionDetail, useRows, useSchema } from '@/lib/queries'
import { useDrawer } from '@/stores/drawer'
import { useLive } from '@/stores/live'
import { runExport } from '@/stores/toast'

const PAGE_SIZE = 100

function FkCells({ value, fk, dbId }: { value: CellValue; fk: FkColumn; dbId: string }) {
  const open = useDrawer((s) => s.open)
  const ids = value === null ? [] : Array.isArray(value) ? value : [value]
  const go = (id: CellValue) =>
    open({ type: 'record', connectionId: dbId, entity: fk.relation.to, key: fk.relation.toField, value: keyString(id) })

  if (!ids.length) {
    return (
      <>
        <td className="border-b border-l border-b-white/[0.035] border-l-accent/10 px-3 py-2">
          <span className="text-[11px] text-zinc-700 italic">NULL</span>
        </td>
        <td className="border-r border-b border-r-accent/10 border-b-white/[0.035] px-3 py-2" />
      </>
    )
  }

  return (
    <>
      <td className="border-b border-l border-b-white/[0.035] border-l-accent/10 bg-accent/[0.015] px-3 py-2 font-mono text-xs whitespace-nowrap text-zinc-500">
        {ids.length === 1 ? (
          <span className="block max-w-[160px] truncate">{keyString(ids[0])}</span>
        ) : (
          `${ids.length} refs`
        )}
      </td>
      <td className="border-r border-b border-r-accent/10 border-b-white/[0.035] bg-accent/[0.015] px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {ids.slice(0, 2).map((id, i) => {
            const label = fk.labels[keyString(id)]
            return (
              <button
                key={i}
                onClick={() => go(id)}
                className={cn(
                  'max-w-[220px] truncate rounded-md px-1.5 py-0.5 text-left text-[13px] transition-colors',
                  label ? 'text-accent hover:bg-accent-dim' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'
                )}
              >
                {label ?? (fk.displayField ? 'missing' : 'open')}
              </button>
            )
          })}
          {ids.length > 2 && <span className="font-mono text-[11px] text-zinc-600">+{ids.length - 2}</span>}
        </div>
      </td>
    </>
  )
}

function PkCell({ value, dbId, entity, field }: { value: CellValue; dbId: string; entity: string; field: string }) {
  const open = useDrawer((s) => s.open)
  if (value === null) return <span className="text-[11px] text-zinc-700 italic">NULL</span>
  return (
    <button
      onClick={() => open({ type: 'record', connectionId: dbId, entity, key: field, value: keyString(value) })}
      className="rounded px-1 font-mono text-xs text-zinc-200 underline decoration-white/10 underline-offset-4 hover:text-accent hover:decoration-accent/50"
    >
      {keyString(value)}
    </button>
  )
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (!dir) return <ArrowDown size={10} className="text-zinc-700 opacity-0 transition-opacity group-hover/h:opacity-100" />
  return dir === 'asc' ? (
    <ArrowUp size={10} weight="bold" className="text-accent" />
  ) : (
    <ArrowDown size={10} weight="bold" className="text-accent" />
  )
}

function HeaderCell({ f, dir, onSort }: { f: FieldMeta; dir: 'asc' | 'desc' | null; onSort: () => void }) {
  return (
    <th rowSpan={2} className="sticky top-0 z-10 h-[60px] border-b hairline bg-ink-925 px-3 text-left align-bottom font-normal">
      <button onClick={onSort} className="group/h flex items-center gap-1.5 pb-2.5 text-left">
        {f.isPrimary && <Key size={11} weight="fill" className="text-warn" />}
        <span className={cn('text-xs font-medium', dir ? 'text-accent' : 'text-zinc-200')}>{f.name}</span>
        <SortIcon dir={dir} />
      </button>
      <div className="-mt-2 pb-2.5 font-mono text-[10px] font-normal text-zinc-600">{f.type}</div>
    </th>
  )
}

const OPS: FilterOp[] = ['eq', 'neq', 'contains', 'gt', 'lt', 'null', 'notnull']
const selectCls =
  'h-7 rounded-md border border-white/[0.08] bg-ink-900 px-2 text-xs text-zinc-200 outline-none focus:border-accent/40'

function FilterBar({
  fields,
  filters,
  onChange
}: {
  fields: FieldMeta[]
  filters: RowFilter[]
  onChange: (f: RowFilter[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [field, setField] = useState('')
  const [op, setOp] = useState<FilterOp>('eq')
  const [value, setValue] = useState('')
  useEffect(() => {
    if (!field && fields[0]) setField(fields[0].name)
  }, [fields, field])

  const apply = () => {
    if (!field) return
    onChange([...filters, needsValue(op) ? { field, op, value } : { field, op }])
    setValue('')
    setAdding(false)
  }

  if (!filters.length && !adding) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        <FunnelSimple size={13} /> Filter
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FunnelSimple size={13} className="text-accent" />
      {filters.map((f, i) => (
        <span
          key={i}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/20 bg-accent/[0.06] pr-1 pl-2 text-xs"
        >
          <span className="text-zinc-200">{f.field}</span>
          <span className="font-mono text-[11px] text-accent">{FILTER_LABEL[f.op]}</span>
          {needsValue(f.op) && <span className="max-w-[160px] truncate font-mono text-[11px] text-zinc-300">{f.value}</span>}
          <button
            onClick={() => onChange(filters.filter((_, j) => j !== i))}
            className="grid size-5 place-items-center rounded text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <select className={selectCls} value={field} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <select className={selectCls} value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
            {OPS.map((o) => (
              <option key={o} value={o}>
                {FILTER_LABEL[o]}
              </option>
            ))}
          </select>
          {needsValue(op) && (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="value"
              className={cn(selectCls, 'w-40 font-mono')}
            />
          )}
          <Button size="sm" variant="primary" type="submit">
            Apply
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add
          </Button>
          <button onClick={() => onChange([])} className="px-1 text-[11px] text-zinc-500 hover:text-zinc-200">
            Clear
          </button>
        </>
      )}
    </div>
  )
}

export function TableView() {
  const { dbId = '', entity: rawEntity = '' } = useParams()
  const entity = decodeURIComponent(rawEntity)
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const live = useLive((s) => s.live)

  const filtersKey = params.getAll('f').join('\u0001')
  const filters = useMemo(
    () => (filtersKey ? filtersKey.split('\u0001') : []).map(decodeFilter).filter((f): f is RowFilter => !!f),
    [filtersKey]
  )
  const sort = params.get('sort')
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc'
  useEffect(() => setPage(0), [dbId, entity, filtersKey, sort, dir])

  const query: RowsQuery = useMemo(
    () => ({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, orderBy: sort, orderDir: dir, filters }),
    [page, sort, dir, filters]
  )
  const schema = useSchema(dbId)
  const detail = useConnectionDetail(dbId)
  const { data, isLoading, isError, error, isFetching, refetch } = useRows(dbId, entity, query)
  const meta = schema.data?.entities.find((e) => e.name === entity)

  const fkByField = useMemo(() => new Map((data?.fkColumns ?? []).map((f) => [f.field, f])), [data])
  const columns = data?.fields ?? meta?.fields.filter((f) => !f.name.includes('.')) ?? []
  const total = data?.total ?? null
  const pages = total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null
  const incoming = schema.data?.relations.filter((r) => r.to === entity).length ?? 0
  const growth = (detail.data?.entityHistory[entity] ?? []).map((p) => p.rows ?? 0)

  const update = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mut(next)
    setParams(next, { replace: true })
  }
  const setFilters = (list: RowFilter[]) =>
    update((p) => {
      p.delete('f')
      for (const f of list) p.append('f', encodeFilter(f))
    })
  const cycleSort = (field: string) =>
    update((p) => {
      if (sort !== field) {
        p.set('sort', field)
        p.set('dir', 'asc')
      } else if (dir === 'asc') p.set('dir', 'desc')
      else {
        p.delete('sort')
        p.delete('dir')
      }
    })
  const dirOf = (field: string) => (sort === field ? dir : null)

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b hairline px-6 py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-50">{entity}</h1>
              {meta && (
                <span className="rounded-md border hairline px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 uppercase">
                  {meta.kind}
                </span>
              )}
              {live && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                  <span className="size-1.5 rounded-full bg-accent" /> LIVE
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              <span className="font-mono text-zinc-400">
                {total === null ? '—' : `${data?.totalIsEstimate ? '≈ ' : ''}${formatExact(total)}`}
              </span>{' '}
              {filters.length ? 'matching ' : ''}rows · {columns.length} columns ·{' '}
              <span className="inline-flex items-center gap-1">
                <LinkSimple size={10} className="text-accent" /> {data?.fkColumns.length ?? 0} out
              </span>{' '}
              / {incoming} in
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {growth.length > 1 && (
              <div className="mr-2 flex items-center gap-2" title="Row count over the last 30 days">
                <Sparkline values={growth} className="h-6 w-24 text-accent/80" height={24} />
                <span className="font-mono text-[10px] text-zinc-500">
                  {growth[growth.length - 1] - growth[0] >= 0 ? '+' : ''}
                  {formatCount(growth[growth.length - 1] - growth[0])}
                </span>
              </div>
            )}
            <Menu
              label={
                <>
                  <DownloadSimple size={13} /> Export
                </>
              }
              items={[
                {
                  label: 'CSV',
                  hint: filters.length ? 'filtered' : 'all rows',
                  onSelect: () => runExport(api.exports.table(dbId, entity, 'csv', filters))
                },
                {
                  label: 'JSON',
                  hint: filters.length ? 'filtered' : 'all rows',
                  onSelect: () => runExport(api.exports.table(dbId, entity, 'json', filters))
                }
              ]}
            />
            <Link to={`/db/${dbId}/schema?focus=${encodeURIComponent(entity)}`}>
              <Button variant="ghost" size="sm">
                <Graph size={13} /> In schema
              </Button>
            </Link>
            <div className="flex items-center gap-1 rounded-lg border hairline p-0.5">
              <Button variant="ghost" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((p) => p - 1)}>
                <CaretLeft size={12} weight="bold" />
              </Button>
              <span className="min-w-[88px] text-center font-mono text-[11px] text-zinc-400">
                {page + 1} / {pages ?? '?'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={isFetching || (pages !== null ? page + 1 >= pages : (data?.rows.length ?? 0) < PAGE_SIZE)}
                onClick={() => setPage((p) => p + 1)}
              >
                <CaretRight size={12} weight="bold" />
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <FilterBar fields={columns} filters={filters} onChange={setFilters} />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {isFetching && !isLoading && !live && (
          <motion.div
            className="absolute top-0 left-0 z-20 h-px bg-accent"
            initial={{ width: '0%' }}
            animate={{ width: '85%' }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        {isError ? (
          <div className="p-6">
            <ErrorState
              title={`Could not load ${entity}`}
              message={(error as Error).message}
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : isLoading ? (
          <div className="space-y-px p-6">
            {Array.from({ length: 14 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-none" />
            ))}
          </div>
        ) : data && data.rows.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              {filters.length ? (
                <>
                  <p className="text-sm text-zinc-300">No rows match these filters</p>
                  <button onClick={() => setFilters([])} className="mt-2 text-xs text-accent hover:underline">
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-300">This {meta?.kind === 'collection' ? 'collection' : 'table'} is empty</p>
                  <p className="mt-1 text-xs text-zinc-600">Rows will show here once something is inserted.</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky top-0 left-0 z-20 w-12 border-b hairline bg-ink-925 px-3" />
                {columns.map((f) => {
                  const fk = fkByField.get(f.name)
                  if (!fk) return <HeaderCell key={f.name} f={f} dir={dirOf(f.name)} onSort={() => cycleSort(f.name)} />
                  return (
                    <th
                      key={f.name}
                      colSpan={2}
                      className="sticky top-0 z-10 h-[30px] border-x border-b border-x-accent/10 border-b-accent/15 bg-ink-925 px-3 text-left font-normal"
                    >
                      <button onClick={() => cycleSort(f.name)} className="group/h flex items-center gap-1.5 text-left">
                        <LinkSimple size={11} weight="bold" className="text-accent" />
                        <span className={cn('text-xs font-medium', dirOf(f.name) ? 'text-accent' : 'text-zinc-100')}>
                          {f.name}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-600">→ {fk.relation.to}</span>
                        {fk.relation.confidence < 1 && (
                          <span className="font-mono text-[10px] text-warn/80" title="Inferred from sampled documents">
                            ~{Math.round(fk.relation.confidence * 100)}%
                          </span>
                        )}
                        <SortIcon dir={dirOf(f.name)} />
                      </button>
                    </th>
                  )
                })}
              </tr>
              <tr>
                {columns.flatMap((f) => {
                  const fk = fkByField.get(f.name)
                  if (!fk) return []
                  return [
                    <th
                      key={`${f.name}:k`}
                      className="sticky top-[30px] z-10 h-[30px] border-b border-l border-b-white/[0.06] border-l-accent/10 bg-ink-925 px-3 text-left font-mono text-[10.5px] font-normal text-zinc-500"
                    >
                      {fk.relation.toField}
                    </th>,
                    <th
                      key={`${f.name}:v`}
                      className="sticky top-[30px] z-10 h-[30px] border-r border-b border-r-accent/10 border-b-white/[0.06] bg-ink-925 px-3 text-left text-[10.5px] font-normal text-zinc-400"
                    >
                      {fk.displayField ?? <span className="text-zinc-600">no label column</span>}
                    </th>
                  ]
                })}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row: Row, i) => (
                <tr key={i} className="group">
                  <td className="sticky left-0 border-b border-white/[0.035] bg-ink-950 px-3 py-2 text-right font-mono text-[10.5px] text-zinc-700 group-hover:bg-ink-900">
                    {page * PAGE_SIZE + i + 1}
                  </td>
                  {columns.map((f) => {
                    const fk = fkByField.get(f.name)
                    const v = row[f.name] ?? null
                    if (fk) return <FkCells key={f.name} value={v} fk={fk} dbId={dbId} />
                    return (
                      <td key={f.name} className="border-b border-white/[0.035] px-3 py-2 whitespace-nowrap group-hover:bg-white/[0.015]">
                        {f.isPrimary ? <PkCell value={v} dbId={dbId} entity={entity} field={f.name} /> : <PlainCell value={v} field={f.name} />}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

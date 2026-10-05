import { ArrowsClockwise, CheckCircle, Copy, LinkBreak, Warning } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Empty, ErrorState, Skeleton } from '@/components/ui'
import { filteredTableUrl } from '@/lib/filters'
import { cn, formatExact, timeAgo } from '@/lib/format'
import { qk, useHealth, useProfile, useSchema } from '@/lib/queries'
import { toast } from '@/stores/toast'

function Section({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border hairline bg-ink-925/50">
      <div className="flex items-start justify-between gap-4 border-b hairline px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Bar({ pct, tone }: { pct: number; tone: 'accent' | 'warn' | 'danger' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
      <div
        className={cn('h-full rounded-full', tone === 'accent' ? 'bg-accent/70' : tone === 'warn' ? 'bg-warn/80' : 'bg-danger/80')}
        style={{ width: `${Math.max(pct * 100, pct > 0 ? 2 : 0)}%` }}
      />
    </div>
  )
}

function Profile({ dbId }: { dbId: string }) {
  const schema = useSchema(dbId)
  const [entity, setEntity] = useState<string | null>(null)
  useEffect(() => {
    if (!entity && schema.data?.entities.length) {
      const busiest = [...schema.data.entities].sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))[0]
      setEntity(busiest.name)
    }
  }, [schema.data, entity])
  const profile = useProfile(dbId, entity)

  return (
    <Section
      title="Data quality"
      hint="Null share, distinct values and dangling references, from a sample of up to 5,000 rows."
      action={
        <select
          value={entity ?? ''}
          onChange={(e) => setEntity(e.target.value)}
          className="h-7 max-w-[220px] rounded-md border border-white/[0.08] bg-ink-900 px-2 text-xs text-zinc-200 outline-none focus:border-accent/40"
        >
          {schema.data?.entities.map((e) => (
            <option key={e.name} value={e.name}>
              {e.name}
            </option>
          ))}
        </select>
      }
    >
      {profile.isLoading || !entity ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : profile.isError ? (
        <ErrorState title="Could not profile this table" message={(profile.error as Error).message} />
      ) : profile.data ? (
        <div className="space-y-6">
          {profile.data.orphans.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">References</h3>
              <ul className="space-y-1.5">
                {profile.data.orphans.map((o) => (
                  <li
                    key={o.relation.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px]',
                      o.missing ? 'border-danger/20 bg-danger/[0.04]' : 'hairline'
                    )}
                  >
                    {o.missing ? (
                      <LinkBreak size={14} className="shrink-0 text-danger" />
                    ) : (
                      <CheckCircle size={14} weight="duotone" className="shrink-0 text-accent" />
                    )}
                    <span className="font-mono text-xs text-zinc-300">
                      {o.relation.fromField} → {o.relation.to}.{o.relation.toField}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">
                      {o.missing ? (
                        <>
                          <span className="text-danger">{o.missing}</span> of {o.checked} values have no target
                          {o.examples.length > 0 && (
                            <Link
                              to={filteredTableUrl(dbId, profile.data.entity, [
                                { field: o.relation.fromField, op: 'eq', value: o.examples[0] }
                              ])}
                              className="ml-2 font-mono text-[11px] text-zinc-400 underline decoration-white/10 underline-offset-2 hover:text-accent"
                            >
                              e.g. {o.examples[0]}
                            </Link>
                          )}
                        </>
                      ) : (
                        `all ${o.checked} sampled values resolve`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
              Columns · {formatExact(profile.data.sampled)} rows sampled
            </h3>
            <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(120px,1fr)_90px_minmax(160px,1.6fr)] gap-x-5 text-[12px]">
              <span className="pb-2 text-[10.5px] text-zinc-600">column</span>
              <span className="pb-2 text-[10.5px] text-zinc-600">null</span>
              <span className="pb-2 text-right text-[10.5px] text-zinc-600">distinct</span>
              <span className="pb-2 text-[10.5px] text-zinc-600">most common</span>
              {profile.data.columns.map((c) => (
                <div key={c.field} className="contents">
                  <span className="truncate border-t hairline py-2 font-mono text-zinc-300">{c.field}</span>
                  <span className="flex items-center gap-2 border-t hairline py-2">
                    <Bar pct={c.nullPct} tone={c.nullPct > 0.5 ? 'danger' : c.nullPct > 0.1 ? 'warn' : 'accent'} />
                    <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-500">{Math.round(c.nullPct * 100)}%</span>
                  </span>
                  <span className="border-t hairline py-2 text-right font-mono text-zinc-400">
                    {formatExact(c.distinct)}
                    {profile.data.sampled > 0 && c.distinct === profile.data.sampled && (
                      <span className="ml-1 text-[10px] text-accent">unique</span>
                    )}
                  </span>
                  <span className="truncate border-t hairline py-2 text-zinc-500">
                    {c.top.map((t, i) => (
                      <span key={i} className="mr-3">
                        <span className="text-zinc-300">{t.value}</span>{' '}
                        <span className="font-mono text-[10px] text-zinc-600">×{t.count}</span>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  )
}

export function HealthView() {
  const { dbId = '' } = useParams()
  const qc = useQueryClient()
  const health = useHealth(dbId)
  const h = health.data

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast('Copied to clipboard'))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-5 px-8 py-7">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Health</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Structural checks and data quality.{' '}
              {h && <span className="font-mono text-xs text-zinc-600">checked {timeAgo(h.checkedAt)}</span>}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: qk.health(dbId) })
              qc.invalidateQueries({ queryKey: ['profile', dbId] })
            }}
            disabled={health.isFetching}
          >
            <ArrowsClockwise size={13} className={cn(health.isFetching && 'animate-spin')} /> Re-check
          </Button>
        </div>

        {health.isError ? (
          <ErrorState title="Could not run checks" message={(health.error as Error).message} />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Foreign keys without index', v: h?.missingFkIndexes.length, bad: (h?.missingFkIndexes.length ?? 0) > 0 },
              { label: 'Tables without primary key', v: h?.tablesWithoutPk.length, bad: (h?.tablesWithoutPk.length ?? 0) > 0 },
              { label: 'Indexes', v: h?.indexCount, bad: false }
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border hairline bg-ink-925/50 px-5 py-4">
                <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{s.label}</p>
                <p className={cn('mt-2 font-mono text-2xl', s.bad ? 'text-warn' : 'text-zinc-50')}>
                  {s.v === undefined ? <Skeleton className="h-7 w-12" /> : s.v}
                </p>
              </div>
            ))}
          </div>
        )}

        {h && (
          <Section
            title="Foreign keys without an index"
            hint="Joins and cascading deletes on these columns scan the whole table. Each line is a ready-to-run fix."
          >
            {h.missingFkIndexes.length === 0 ? (
              <Empty title="Every foreign key has a supporting index" />
            ) : (
              <ul className="space-y-1.5">
                {h.missingFkIndexes.map(({ relation, suggestion }) => (
                  <li key={relation.id} className="rounded-lg border hairline px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[13px]">
                      <Warning size={13} className="shrink-0 text-warn" />
                      <span className="font-mono text-xs text-zinc-200">
                        {relation.from}.{relation.fromField}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-600">→ {relation.to}</span>
                    </div>
                    {suggestion && (
                      <div className="mt-2 flex items-center gap-2 rounded-md bg-ink-950/70 px-2.5 py-1.5">
                        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-accent/90">{suggestion}</code>
                        <button onClick={() => copy(suggestion)} className="shrink-0 text-zinc-600 hover:text-zinc-200" title="Copy">
                          <Copy size={12} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {h && h.tablesWithoutPk.length > 0 && (
          <Section title="Tables without a primary key" hint="Rows cannot be addressed reliably; replication and editing suffer.">
            <div className="flex flex-wrap gap-1.5">
              {h.tablesWithoutPk.map((t) => (
                <Link
                  key={t}
                  to={`/db/${dbId}/table/${encodeURIComponent(t)}`}
                  className="rounded-md border hairline px-2 py-1 font-mono text-xs text-zinc-300 hover:border-accent/30 hover:text-accent"
                >
                  {t}
                </Link>
              ))}
            </div>
          </Section>
        )}

        <Profile dbId={dbId} />
      </div>
    </div>
  )
}

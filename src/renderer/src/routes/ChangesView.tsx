import { ArrowsClockwise, Flag, LinkSimple, Minus, PencilSimple, Plus, Table } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { SchemaChange } from '@shared/types'
import { Button, Empty, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/format'
import { api, qk, useSchemaChanges } from '@/lib/queries'
import { toast } from '@/stores/toast'

function Line({ tone, icon, children }: { tone: 'add' | 'remove' | 'change'; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[12px]',
        tone === 'add' && 'bg-accent/[0.05] text-accent',
        tone === 'remove' && 'bg-danger/[0.05] text-danger',
        tone === 'change' && 'bg-warn/[0.05] text-warn'
      )}
    >
      {icon ?? (tone === 'add' ? <Plus size={11} /> : tone === 'remove' ? <Minus size={11} /> : <PencilSimple size={11} />)}
      {children}
    </li>
  )
}

function countOf(c: SchemaChange): number {
  return (
    c.entitiesAdded.length +
    c.entitiesRemoved.length +
    c.relationsAdded.length +
    c.relationsRemoved.length +
    c.fieldChanges.reduce((s, f) => s + f.added.length + f.removed.length + f.changed.length, 0)
  )
}

export function ChangesView() {
  const { dbId = '' } = useParams()
  const qc = useQueryClient()
  const changes = useSchemaChanges(dbId)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    try {
      const before = changes.data?.length ?? 0
      const fresh = await api.schema.get(dbId, true)
      qc.setQueryData(qk.schema(dbId), fresh)
      const list = await qc.fetchQuery({ queryKey: qk.changes(dbId), queryFn: () => api.schema.changes(dbId) })
      toast(list.length > before ? 'Schema changed since the last check' : 'No schema changes')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-8 py-7">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Schema changes</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Every time the schema is read, it is compared with the previous version. Tables, columns, types and relations are tracked.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={check} disabled={checking}>
            <ArrowsClockwise size={13} className={cn(checking && 'animate-spin')} /> Check now
          </Button>
        </div>

        <div className="mt-7">
          {changes.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : changes.isError ? (
            <ErrorState title="Could not load history" message={(changes.error as Error).message} />
          ) : !changes.data?.length ? (
            <Empty title="No history yet" hint="Press Check now to record the first version of this schema." />
          ) : (
            <ol className="relative space-y-4 border-l hairline pl-6">
              {changes.data.map((c, i) => (
                <motion.li
                  key={c.takenAt + ':' + i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.4), type: 'spring', stiffness: 260, damping: 28 }}
                  className="relative"
                >
                  <span
                    className={cn(
                      'absolute top-4 -left-[29px] size-2.5 rounded-full border-2 border-ink-950',
                      c.baseline ? 'bg-zinc-500' : 'bg-accent'
                    )}
                  />
                  <div className="rounded-2xl border hairline bg-ink-925/50 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-2 text-sm text-zinc-100">
                        {c.baseline ? (
                          <>
                            <Flag size={13} className="text-zinc-500" /> First recorded version
                          </>
                        ) : (
                          `${countOf(c)} change${countOf(c) === 1 ? '' : 's'}`
                        )}
                      </p>
                      <time className="font-mono text-[11px] text-zinc-500">{new Date(c.takenAt).toLocaleString()}</time>
                    </div>
                    {c.baseline ? (
                      <p className="mt-1 text-xs text-zinc-500">{c.entitiesAdded.length} tables at this point.</p>
                    ) : (
                      <ul className="mt-3 space-y-1">
                        {c.entitiesAdded.map((e) => (
                          <Line key={`ea:${e}`} tone="add" icon={<Table size={11} />}>
                            table {e}
                          </Line>
                        ))}
                        {c.entitiesRemoved.map((e) => (
                          <Line key={`er:${e}`} tone="remove" icon={<Table size={11} />}>
                            table {e}
                          </Line>
                        ))}
                        {c.fieldChanges.flatMap((f) => [
                          ...f.added.map((x) => (
                            <Line key={`fa:${f.entity}.${x}`} tone="add">
                              {f.entity}.{x}
                            </Line>
                          )),
                          ...f.removed.map((x) => (
                            <Line key={`fr:${f.entity}.${x}`} tone="remove">
                              {f.entity}.{x}
                            </Line>
                          )),
                          ...f.changed.map((x) => (
                            <Line key={`fc:${f.entity}.${x.field}`} tone="change">
                              {f.entity}.{x.field}: {x.from} → {x.to}
                            </Line>
                          ))
                        ])}
                        {c.relationsAdded.map((r) => (
                          <Line key={`ra:${r}`} tone="add" icon={<LinkSimple size={11} />}>
                            {r}
                          </Line>
                        ))}
                        {c.relationsRemoved.map((r) => (
                          <Line key={`rr:${r}`} tone="remove" icon={<LinkSimple size={11} />}>
                            {r}
                          </Line>
                        ))}
                      </ul>
                    )}
                  </div>
                </motion.li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { RowsQuery } from '@shared/types'
import { LIVE_ROWS_MS, LIVE_SNAPSHOT_GAP_MS, LIVE_SNAPSHOT_TICK_MS, LIVE_STATS_MS, useLive } from '@/stores/live'

export const api = window.api

export const qk = {
  overview: ['overview'] as const,
  connections: ['connections'] as const,
  detail: (id: string) => ['detail', id] as const,
  schema: (id: string) => ['schema', id] as const,
  rows: (id: string, entity: string, query: RowsQuery) => ['rows', id, entity, query] as const,
  record: (id: string, entity: string, key: string, value: string) => ['record', id, entity, key, value] as const,
  layout: (id: string) => ['layout', id] as const,
  queryHistory: (id: string) => ['queryHistory', id] as const,
  health: (id: string) => ['health', id] as const,
  profile: (id: string, entity: string) => ['profile', id, entity] as const,
  changes: (id: string) => ['changes', id] as const,
  alerts: (id: string) => ['alerts', id] as const
}

function useLiveInterval(ms: number): number | false {
  return useLive((s) => s.live) ? ms : false
}

export function useOverview() {
  const refetchInterval = useLiveInterval(LIVE_STATS_MS)
  return useQuery({ queryKey: qk.overview, queryFn: api.analytics.overview, staleTime: 5_000, refetchInterval })
}

export function useConnections() {
  return useQuery({ queryKey: qk.connections, queryFn: api.connections.list })
}

export function useConnectionDetail(id: string) {
  const refetchInterval = useLiveInterval(LIVE_STATS_MS)
  return useQuery({
    queryKey: qk.detail(id),
    queryFn: () => api.connections.detail(id),
    enabled: !!id,
    refetchInterval
  })
}

export function useSchema(id: string) {
  return useQuery({
    queryKey: qk.schema(id),
    queryFn: () => api.schema.get(id),
    staleTime: Infinity,
    retry: false
  })
}

export function useRows(id: string, entity: string, query: RowsQuery) {
  const refetchInterval = useLiveInterval(LIVE_ROWS_MS)
  return useQuery({
    queryKey: qk.rows(id, entity, query),
    queryFn: () => api.rows.fetch(id, entity, query),
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval
  })
}

export function useRecord(id: string, entity: string, key: string, value: string) {
  return useQuery({
    queryKey: qk.record(id, entity, key, value),
    queryFn: () => api.record.get(id, entity, key, value),
    retry: false
  })
}

export function useQueryHistory(id: string) {
  return useQuery({ queryKey: qk.queryHistory(id), queryFn: () => api.query.history(id) })
}

export function useHealth(id: string) {
  return useQuery({ queryKey: qk.health(id), queryFn: () => api.health.get(id), retry: false, staleTime: 60_000 })
}

export function useProfile(id: string, entity: string | null) {
  return useQuery({
    queryKey: qk.profile(id, entity ?? ''),
    queryFn: () => api.health.profile(id, entity!),
    enabled: !!entity,
    retry: false,
    staleTime: 60_000
  })
}

export function useSchemaChanges(id: string) {
  return useQuery({ queryKey: qk.changes(id), queryFn: () => api.schema.changes(id), retry: false })
}

export function useAlerts(id: string) {
  const refetchInterval = useLiveInterval(LIVE_STATS_MS)
  return useQuery({ queryKey: qk.alerts(id), queryFn: () => api.alerts.list(id), refetchInterval })
}

/** Refreshes analytics-driven queries whenever the main process finishes a snapshot round */
export function useAnalyticsSubscription(): void {
  const qc = useQueryClient()
  useEffect(
    () =>
      api.analytics.onUpdated(() => {
        qc.invalidateQueries({ queryKey: qk.overview })
        qc.invalidateQueries({ queryKey: ['detail'] })
        qc.invalidateQueries({ queryKey: ['alerts'] })
      }),
    [qc]
  )
}

/** While live mode is on, periodically asks the main process for fresh snapshots */
export function useLiveSnapshots(): void {
  const live = useLive((s) => s.live)
  useEffect(() => {
    if (!live) return
    const tick = () => void api.analytics.refresh(undefined, LIVE_SNAPSHOT_GAP_MS).catch(() => {})
    tick()
    const t = setInterval(tick, LIVE_SNAPSHOT_TICK_MS)
    return () => clearInterval(t)
  }, [live])
}

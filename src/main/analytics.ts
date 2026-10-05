import type { Snapshot } from '../shared/types'
import { adapterFor, dropAdapter } from './adapters'
import { evaluateAlerts } from './alerts'
import { insertSnapshot, latestSnapshot, listConnections, pruneHistory } from './store'

const TIMEOUT_MS = 25_000
const INTERVAL_MS = 15 * 60_000

const running = new Map<string, Promise<Snapshot>>()

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export function takeSnapshot(connectionId: string): Promise<Snapshot> {
  const inflight = running.get(connectionId)
  if (inflight) return inflight
  const job = (async (): Promise<Snapshot> => {
    const started = Date.now()
    try {
      const adapter = await withTimeout(adapterFor(connectionId), TIMEOUT_MS)
      const t0 = performance.now()
      await withTimeout(adapter.ping(), TIMEOUT_MS)
      const latencyMs = Math.round(performance.now() - t0)
      const stats = await withTimeout(adapter.getStats(), TIMEOUT_MS)
      const snap: Snapshot = {
        connectionId,
        takenAt: started,
        status: 'ok',
        latencyMs,
        sizeBytes: stats.sizeBytes,
        entityCount: stats.entities.length,
        rowCount: stats.entities.reduce((s, e) => s + (e.rowCount ?? 0), 0)
      }
      insertSnapshot(snap, stats.entities)
      evaluateAlerts(snap)
      return snap
    } catch (err) {
      await dropAdapter(connectionId)
      const snap: Snapshot = {
        connectionId,
        takenAt: started,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: null,
        sizeBytes: null,
        entityCount: null,
        rowCount: null
      }
      insertSnapshot(snap, [])
      evaluateAlerts(snap)
      return snap
    }
  })()
  running.set(connectionId, job)
  job.finally(() => running.delete(connectionId))
  return job
}

/** Snapshots every connection; with minGapMs, connections snapshotted more recently than that are skipped */
export async function snapshotAll(minGapMs = 0): Promise<void> {
  const now = Date.now()
  await Promise.all(
    listConnections()
      .filter((c) => !minGapMs || now - (latestSnapshot(c.id)?.takenAt ?? 0) >= minGapMs)
      .map((c) => takeSnapshot(c.id))
  )
}

export function startAnalyticsLoop(onUpdate: () => void): () => void {
  const tick = (): void => {
    snapshotAll().then(() => {
      pruneHistory()
      onUpdate()
    }, () => {})
  }
  const first = setTimeout(tick, 1500)
  const loop = setInterval(tick, INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(loop)
  }
}

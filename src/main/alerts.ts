import { Notification } from 'electron'
import type { AlertRule, Snapshot } from '../shared/types'
import * as store from './store'

const COOLDOWN_MS = 6 * 60 * 60_000
const DAY = 86_400_000

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function check(rule: AlertRule, snap: Snapshot): string | null {
  switch (rule.kind) {
    case 'offline':
      return snap.status === 'error' ? `Connection failed: ${snap.error ?? 'unknown error'}` : null
    case 'size_gt':
      return snap.sizeBytes !== null && snap.sizeBytes > rule.threshold * 1024 * 1024
        ? `Size ${mb(snap.sizeBytes)} is above ${rule.threshold} MB`
        : null
    case 'growth_pct': {
      if (snap.status !== 'ok' || snap.sizeBytes === null) return null
      const before = store.snapshotBefore(rule.connectionId, snap.takenAt - DAY)
      if (!before?.sizeBytes) return null
      const pct = ((snap.sizeBytes - before.sizeBytes) / before.sizeBytes) * 100
      return pct > rule.threshold ? `Grew ${pct.toFixed(1)}% in 24h (${mb(before.sizeBytes)} → ${mb(snap.sizeBytes)})` : null
    }
  }
}

/** Evaluates the connection's alert rules against a fresh snapshot; returns true when anything fired */
export function evaluateAlerts(snap: Snapshot): boolean {
  const rules = store.listAlertRules(snap.connectionId)
  if (!rules.length) return false
  const conn = store.getConnection(snap.connectionId)
  let fired = false
  for (const rule of rules) {
    const message = check(rule, snap)
    if (!message) continue
    const last = store.lastAlertEvent(rule.id)
    if (last && Date.now() - last < COOLDOWN_MS) continue
    store.addAlertEvent(snap.connectionId, rule.id, message)
    fired = true
    if (Notification.isSupported()) {
      new Notification({ title: `Viewdata · ${conn?.info.name ?? 'Database'}`, body: message, silent: false }).show()
    }
  }
  return fired
}

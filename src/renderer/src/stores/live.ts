import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LiveState {
  live: boolean
  toggle: () => void
}

export const useLive = create<LiveState>()(
  persist((set) => ({ live: false, toggle: () => set((s) => ({ live: !s.live })) }), { name: 'viewdata.live' })
)

export const LIVE_ROWS_MS = 5_000
export const LIVE_STATS_MS = 10_000
/** How often live mode asks the main process for fresh snapshots, and the minimum gap it enforces */
export const LIVE_SNAPSHOT_TICK_MS = 30_000
export const LIVE_SNAPSHOT_GAP_MS = 120_000

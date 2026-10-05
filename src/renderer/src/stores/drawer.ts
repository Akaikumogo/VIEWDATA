import { create } from 'zustand'
import type { CellValue } from '@shared/types'

export type DrawerEntry =
  | { type: 'record'; connectionId: string; entity: string; key: string; value: string }
  | { type: 'json'; title: string; value: CellValue }

interface DrawerState {
  stack: DrawerEntry[]
  open: (entry: DrawerEntry) => void
  push: (entry: DrawerEntry) => void
  back: () => void
  jump: (index: number) => void
  close: () => void
}

export const useDrawer = create<DrawerState>((set) => ({
  stack: [],
  open: (entry) => set({ stack: [entry] }),
  push: (entry) => set((s) => ({ stack: [...s.stack, entry] })),
  back: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  jump: (index) => set((s) => ({ stack: s.stack.slice(0, index + 1) })),
  close: () => set({ stack: [] })
}))

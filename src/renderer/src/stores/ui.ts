import { create } from 'zustand'
import type { ConnectionInfo } from '@shared/types'

interface UiState {
  dialogOpen: boolean
  editing: ConnectionInfo | null
  openNew: () => void
  openEdit: (c: ConnectionInfo) => void
  closeDialog: () => void
}

export const useUi = create<UiState>((set) => ({
  dialogOpen: false,
  editing: null,
  openNew: () => set({ dialogOpen: true, editing: null }),
  openEdit: (c) => set({ dialogOpen: true, editing: c }),
  closeDialog: () => set({ dialogOpen: false })
}))

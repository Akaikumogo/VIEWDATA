import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error'
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'ok') => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = (message: string, tone?: Toast['tone']) => useToasts.getState().push(message, tone)

/** Runs an export call and reports the outcome; cancelled dialogs stay silent */
export async function runExport(p: Promise<{ path: string; rows?: number } | null>): Promise<void> {
  try {
    const res = await p
    if (res) toast(`Saved${res.rows !== undefined ? ` ${res.rows.toLocaleString()} rows` : ''} to ${res.path}`)
  } catch (err) {
    toast((err as Error).message, 'error')
  }
}

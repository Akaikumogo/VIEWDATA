import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useToasts } from '@/stores/toast'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[380px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-ink-900/95 px-3.5 py-3 shadow-2xl shadow-black/60 backdrop-blur"
          >
            {t.tone === 'ok' ? (
              <CheckCircle size={16} weight="duotone" className="mt-px shrink-0 text-accent" />
            ) : (
              <WarningCircle size={16} weight="duotone" className="mt-px shrink-0 text-danger" />
            )}
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed break-words text-zinc-300">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="shrink-0 text-zinc-600 hover:text-zinc-300">
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

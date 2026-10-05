import { CaretRight, MagnifyingGlass } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useLocation, useMatch, useOutlet } from 'react-router-dom'
import { cn } from '@/lib/format'
import { useAnalyticsSubscription, useConnectionDetail, useLiveSnapshots } from '@/lib/queries'
import { useLive } from '@/stores/live'
import { useUi } from '@/stores/ui'
import { CommandPalette } from './CommandPalette'
import { ConnectionDialog } from './ConnectionDialog'
import { Toaster } from './Toaster'

const PAGE_LABEL: Record<string, string> = { query: 'Query', health: 'Health', changes: 'Changes' }
import { DbSidebar } from './DbSidebar'
import { HomeSidebar } from './HomeSidebar'
import { RecordDrawer } from './RecordDrawer'

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="3" width="8" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13.5" y="15" width="8" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13.5" y="3" width="8" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <path d="M6.5 9v4.5a1.5 1.5 0 0 0 1.5 1.5h5.5" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function Breadcrumb() {
  const db = useMatch('/db/:dbId/*')
  const table = useMatch('/db/:dbId/table/:entity')
  const schema = useMatch('/db/:dbId/schema')
  const page = useMatch('/db/:dbId/:page')
  const { data } = useConnectionDetail(db?.params.dbId ?? '')
  const conn = db ? data?.connection : undefined
  const crumbs: { label: string; to?: string }[] = [{ label: 'Overview', to: '/' }]
  if (db) crumbs.push({ label: conn?.name ?? 'Database', to: `/db/${db.params.dbId}` })
  if (table) crumbs.push({ label: decodeURIComponent(table.params.entity ?? '') })
  if (schema) crumbs.push({ label: 'Schema' })
  if (page && PAGE_LABEL[page.params.page ?? '']) crumbs.push({ label: PAGE_LABEL[page.params.page ?? ''] })
  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-xs">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <CaretRight size={10} className="shrink-0 text-zinc-700" />}
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="no-drag truncate text-zinc-500 transition-colors hover:text-zinc-200">
              {c.label}
            </Link>
          ) : (
            <span className="truncate text-zinc-300">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function AppShell() {
  useAnalyticsSubscription()
  useLiveSnapshots()
  const { live, toggle: toggleLive } = useLive()
  const location = useLocation()
  const outlet = useOutlet()
  const db = useMatch('/db/:dbId/*')
  const { dialogOpen, editing, closeDialog } = useUi()
  const sidebarKey = db ? `db:${db.params.dbId}` : 'home'
  const pageKey = location.pathname.startsWith('/db/') ? location.pathname : 'home'

  return (
    <div className="grain flex h-full flex-col">
      <header className="drag flex h-10 shrink-0 items-center border-b hairline">
        <div className="flex h-full w-72 shrink-0 items-center gap-2.5 border-r hairline px-4 text-zinc-100">
          <LogoMark />
          <span className="text-[13px] font-semibold tracking-tight">Viewdata</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 px-5 pr-40">
          <Breadcrumb />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="no-drag flex h-6 items-center gap-2 rounded-md border hairline px-2 text-[11px] text-zinc-500 transition-colors hover:border-white/[0.12] hover:text-zinc-300"
            >
              <MagnifyingGlass size={11} /> Search
              <kbd className="font-mono text-[10px] text-zinc-600">Ctrl K</kbd>
            </button>
            <button
              onClick={toggleLive}
              title={live ? 'Live refresh is on: data and stats update every few seconds' : 'Turn on live refresh'}
              className={cn(
                'no-drag flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors',
                live
                  ? 'border-accent/30 bg-accent/[0.08] text-accent'
                  : 'border-white/[0.06] text-zinc-500 hover:border-white/[0.12] hover:text-zinc-300'
              )}
            >
              <span className={cn('size-1.5 rounded-full', live ? 'bg-accent' : 'bg-zinc-600')} />
              Live
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="relative w-72 shrink-0 overflow-hidden border-r hairline bg-ink-925">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={sidebarKey}
              className="absolute inset-0"
              initial={{ opacity: 0, x: db ? 40 : -40, filter: 'blur(6px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: db ? -40 : 40, filter: 'blur(6px)' }}
              transition={{ type: 'spring', stiffness: 220, damping: 28 }}
            >
              {db ? <DbSidebar /> : <HomeSidebar />}
            </motion.div>
          </AnimatePresence>
        </aside>

        <main className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pageKey}
              className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <ConnectionDialog open={dialogOpen} editing={editing} onClose={closeDialog} />
      <RecordDrawer />
      <CommandPalette />
      <Toaster />
    </div>
  )
}

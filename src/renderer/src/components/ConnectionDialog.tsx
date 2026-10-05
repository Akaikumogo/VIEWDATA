import { CheckCircle, CircleNotch, Lightning, PencilSimple, ShieldCheck, X } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DEFAULT_PORT,
  KIND_LABEL,
  type ConnectionInfo,
  type ConnectionInput,
  type DbKind,
  type SshOptions,
  type TestResult
} from '@shared/types'
import { cn } from '@/lib/format'
import { api, qk } from '@/lib/queries'
import { Button, KindBadge, Toggle } from './ui'

const KINDS: DbKind[] = ['postgres', 'mysql', 'mariadb', 'oracle', 'mongodb']

function emptyForm(kind: DbKind = 'postgres'): ConnectionInput {
  return {
    name: '',
    kind,
    host: 'localhost',
    port: DEFAULT_PORT[kind],
    database: '',
    username: kind === 'postgres' ? 'postgres' : kind === 'oracle' ? 'system' : kind === 'mongodb' ? '' : 'root',
    password: '',
    options: {}
  }
}

function Field({
  label,
  helper,
  children,
  className
}: {
  label: string
  helper?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-2', className)}>
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {helper && <span className="text-[11px] leading-snug text-zinc-600">{helper}</span>}
    </label>
  )
}

const inputCls =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-ink-950/60 px-3 text-[13px] text-zinc-100 outline-none ' +
  'placeholder:text-zinc-600 transition-colors focus:border-accent/50 focus:bg-ink-950'

export function ConnectionDialog({
  open,
  onClose,
  editing
}: {
  open: boolean
  onClose: () => void
  editing?: ConnectionInfo | null
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState<ConnectionInput>(emptyForm())
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [sshTouched, setSshTouched] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTest(null)
    setError(null)
    setPasswordTouched(false)
    setSshTouched(false)
    setForm(
      editing
        ? {
            name: editing.name,
            kind: editing.kind,
            host: editing.host,
            port: editing.port,
            database: editing.database,
            username: editing.username,
            password: '',
            options: { ...editing.options }
          }
        : emptyForm()
    )
  }, [open, editing])

  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTest(null)
    setError(null)
  }

  const payload = (): ConnectionInput => ({
    ...form,
    name: form.name.trim() || `${KIND_LABEL[form.kind]} · ${form.database || form.host}`,
    password: editing && !passwordTouched ? undefined : form.password,
    sshSecret: editing && !sshTouched ? undefined : (form.sshSecret ?? '')
  })

  const runTest = async () => {
    setBusy('test')
    setError(null)
    try {
      setTest(await api.connections.test(payload(), editing?.id))
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    setError(null)
    try {
      const id = editing
        ? await api.connections.update(editing.id, payload())
        : await api.connections.create(payload())
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.overview }),
        qc.invalidateQueries({ queryKey: qk.connections }),
        qc.removeQueries({ queryKey: qk.schema(id) })
      ])
      onClose()
      if (!editing) navigate(`/db/${id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const isMongo = form.kind === 'mongodb'
  const ssh: SshOptions = form.options.ssh ?? { enabled: false, host: '', port: 22, username: '', auth: 'password' }
  const setSsh = (patch: Partial<SshOptions>) => set('options', { ...form.options, ssh: { ...ssh, ...patch } })
  const usesUri = isMongo && !!form.options.uri?.trim() && !ssh.enabled

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 grid place-items-center bg-ink-950/70 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="glass w-full max-w-[640px] overflow-hidden rounded-2xl"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <div className="flex items-start justify-between border-b hairline px-6 py-5">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-zinc-50">
                  {editing ? 'Edit connection' : 'New connection'}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Credentials stay on this machine, encrypted with the OS keychain.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
                <X size={14} />
              </Button>
            </div>

            <div className="flex max-h-[68vh] flex-col gap-5 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-5 gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...emptyForm(k),
                        name: f.name,
                        host: f.host,
                        database: f.database,
                        password: f.password
                      }))
                    }
                    className={cn(
                      'relative flex flex-col items-center gap-2 rounded-xl border px-2 py-3 text-[11px] transition-colors',
                      form.kind === k
                        ? 'border-accent/40 bg-accent-dim text-zinc-100'
                        : 'border-white/[0.06] text-zinc-400 hover:border-white/[0.12] hover:text-zinc-200'
                    )}
                  >
                    <KindBadge kind={k} className={form.kind === k ? 'border-accent/40 text-accent' : ''} />
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-6 gap-4">
                <Field label="Display name" className="col-span-6">
                  <input
                    className={inputCls}
                    value={form.name}
                    placeholder="Billing replica"
                    onChange={(e) => set('name', e.target.value)}
                  />
                </Field>

                {isMongo && (
                  <Field
                    label="Connection URI"
                    helper="Optional. When set, host, port and credentials below are ignored."
                    className="col-span-6"
                  >
                    <input
                      className={cn(inputCls, 'font-mono text-xs')}
                      value={form.options.uri ?? ''}
                      placeholder="mongodb+srv://user:pass@cluster0.example.net/app"
                      onChange={(e) => set('options', { ...form.options, uri: e.target.value })}
                    />
                  </Field>
                )}

                <Field label="Host" className={cn('col-span-4', usesUri && 'opacity-40')}>
                  <input
                    className={inputCls}
                    value={form.host}
                    disabled={usesUri}
                    onChange={(e) => set('host', e.target.value)}
                  />
                </Field>
                <Field label="Port" className={cn('col-span-2', usesUri && 'opacity-40')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.port || ''}
                    inputMode="numeric"
                    disabled={usesUri}
                    onChange={(e) => set('port', Number(e.target.value.replace(/\D/g, '')) || 0)}
                  />
                </Field>

                <Field
                  label={form.kind === 'oracle' ? 'Service name' : 'Database'}
                  helper={form.kind === 'oracle' ? 'FREEPDB1, ORCLPDB1, or a full connect descriptor' : undefined}
                  className="col-span-3"
                >
                  <input
                    className={inputCls}
                    value={form.database}
                    placeholder={form.kind === 'oracle' ? 'FREEPDB1' : isMongo ? 'app' : 'warehouse'}
                    onChange={(e) => set('database', e.target.value)}
                  />
                </Field>
                <Field
                  label={form.kind === 'oracle' ? 'Schema owner' : form.kind === 'postgres' ? 'Schema' : 'Schema'}
                  helper={
                    form.kind === 'oracle'
                      ? 'Defaults to the login user'
                      : form.kind === 'postgres'
                        ? 'Empty = all non-system schemas'
                        : 'Uses the database name'
                  }
                  className={cn('col-span-3', (isMongo || form.kind === 'mysql' || form.kind === 'mariadb') && 'opacity-40')}
                >
                  <input
                    className={inputCls}
                    value={form.options.schema ?? ''}
                    disabled={isMongo || form.kind === 'mysql' || form.kind === 'mariadb'}
                    placeholder={form.kind === 'postgres' ? 'public' : ''}
                    onChange={(e) => set('options', { ...form.options, schema: e.target.value })}
                  />
                </Field>

                <Field label="Username" className={cn('col-span-3', usesUri && 'opacity-40')}>
                  <input
                    className={inputCls}
                    value={form.username}
                    disabled={usesUri}
                    onChange={(e) => set('username', e.target.value)}
                  />
                </Field>
                <Field
                  label="Password"
                  helper={editing && !passwordTouched ? 'Leave untouched to keep the saved password' : undefined}
                  className={cn('col-span-3', usesUri && 'opacity-40')}
                >
                  <input
                    className={inputCls}
                    type="password"
                    value={form.password ?? ''}
                    disabled={usesUri}
                    placeholder={editing && !passwordTouched ? '••••••••' : ''}
                    onChange={(e) => {
                      setPasswordTouched(true)
                      set('password', e.target.value)
                    }}
                  />
                </Field>

                {form.kind !== 'oracle' && (
                  <label className="col-span-6 flex items-center gap-2.5 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--color-accent)]"
                      checked={!!form.options.ssl}
                      onChange={(e) => set('options', { ...form.options, ssl: e.target.checked })}
                    />
                    Use SSL / TLS
                  </label>
                )}
              </div>

              <div className="rounded-xl border hairline">
                <div className="flex items-center justify-between px-4 py-3">
                  <Toggle
                    checked={!!ssh.enabled}
                    onChange={(v) => setSsh({ enabled: v })}
                    label={
                      <span className="flex items-center gap-2">
                        <ShieldCheck size={14} className="text-zinc-500" /> Connect through an SSH tunnel
                      </span>
                    }
                  />
                  {ssh.enabled && <span className="text-[11px] text-zinc-600">host and port above are resolved on the SSH server</span>}
                </div>
                <AnimatePresence initial={false}>
                  {ssh.enabled && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-6 gap-4 border-t hairline px-4 py-4">
                        <Field label="SSH host" className="col-span-4">
                          <input
                            className={inputCls}
                            value={ssh.host}
                            placeholder="bastion.example.com"
                            onChange={(e) => setSsh({ host: e.target.value })}
                          />
                        </Field>
                        <Field label="SSH port" className="col-span-2">
                          <input
                            className={cn(inputCls, 'font-mono')}
                            value={ssh.port || ''}
                            inputMode="numeric"
                            onChange={(e) => setSsh({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                          />
                        </Field>
                        <Field label="SSH user" className="col-span-3">
                          <input className={inputCls} value={ssh.username} onChange={(e) => setSsh({ username: e.target.value })} />
                        </Field>
                        <Field label="Authentication" className="col-span-3">
                          <div className="grid h-9 grid-cols-2 gap-1 rounded-lg border border-white/[0.08] bg-ink-950/60 p-1">
                            {(['password', 'key'] as const).map((a) => (
                              <button
                                key={a}
                                type="button"
                                onClick={() => setSsh({ auth: a })}
                                className={cn(
                                  'rounded-md text-xs',
                                  ssh.auth === a ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                                )}
                              >
                                {a === 'password' ? 'Password' : 'Private key'}
                              </button>
                            ))}
                          </div>
                        </Field>
                        {ssh.auth === 'key' && (
                          <Field label="Private key file" className="col-span-6">
                            <div className="flex gap-2">
                              <input
                                className={cn(inputCls, 'font-mono text-xs')}
                                value={ssh.privateKeyPath ?? ''}
                                placeholder="C:\Users\you\.ssh\id_ed25519"
                                onChange={(e) => setSsh({ privateKeyPath: e.target.value })}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={async () => {
                                  const p = await api.dialog.openFile('Choose SSH private key')
                                  if (p) setSsh({ privateKeyPath: p })
                                }}
                              >
                                Browse
                              </Button>
                            </div>
                          </Field>
                        )}
                        <Field
                          label={ssh.auth === 'key' ? 'Key passphrase' : 'SSH password'}
                          helper={
                            editing && !sshTouched
                              ? 'Leave untouched to keep the saved secret'
                              : ssh.auth === 'key'
                                ? 'Only if the key is encrypted'
                                : undefined
                          }
                          className="col-span-6"
                        >
                          <input
                            className={inputCls}
                            type="password"
                            value={form.sshSecret ?? ''}
                            placeholder={editing && !sshTouched ? '••••••••' : ''}
                            onChange={(e) => {
                              setSshTouched(true)
                              set('sshSecret', e.target.value)
                            }}
                          />
                        </Field>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="rounded-xl border hairline px-4 py-3">
                <Toggle
                  checked={!!form.options.allowWrites}
                  onChange={(v) => set('options', { ...form.options, allowWrites: v })}
                  label={
                    <span className="flex items-center gap-2">
                      <PencilSimple size={14} className="text-zinc-500" /> Allow writes
                    </span>
                  }
                />
                <p className="mt-1.5 pl-[42px] text-[11px] leading-snug text-zinc-600">
                  Off by default: the query editor only runs read statements inside read-only transactions and rows cannot be edited.
                </p>
              </div>

              <AnimatePresence mode="wait">
                {test && (
                  <motion.div
                    key={test.ok ? 'ok' : 'err'}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs',
                      test.ok ? 'border-accent/25 bg-accent-dim text-zinc-200' : 'border-danger/25 bg-danger/[0.06] text-zinc-300'
                    )}
                  >
                    {test.ok ? (
                      <>
                        <CheckCircle size={15} weight="fill" className="mt-px shrink-0 text-accent" />
                        <span>
                          Connected in <span className="font-mono text-accent">{test.latencyMs} ms</span>
                          {test.serverVersion && <span className="text-zinc-500"> · {test.serverVersion}</span>}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono leading-relaxed break-words text-danger">{test.error}</span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              {error && <p className="font-mono text-xs text-danger">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t hairline bg-ink-950/40 px-6 py-4">
              <Button variant="ghost" onClick={runTest} disabled={!!busy}>
                {busy === 'test' ? <CircleNotch size={14} className="animate-spin" /> : <Lightning size={14} />}
                Test connection
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={save} disabled={!!busy}>
                  {busy === 'save' && <CircleNotch size={14} className="animate-spin" />}
                  {editing ? 'Save changes' : 'Connect'}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

import type { ConnectionInfo } from '../../shared/types'
import { decryptSecret } from '../secrets'
import { getConnection } from '../store'
import { openTunnel } from '../tunnel'
import { DemoAdapter } from './demo'
import { MongoAdapter } from './mongo'
import { MySqlAdapter } from './mysql'
import { OracleAdapter } from './oracle'
import { PostgresAdapter } from './postgres'
import type { AdapterContext, DbAdapter } from './types'

export function createAdapter(info: ConnectionInfo, password: string): DbAdapter {
  const ctx: AdapterContext = { info, password }
  switch (info.kind) {
    case 'postgres':
      return new PostgresAdapter(ctx)
    case 'mysql':
      return new MySqlAdapter(ctx, 'mysql')
    case 'mariadb':
      return new MySqlAdapter(ctx, 'mariadb')
    case 'oracle':
      return new OracleAdapter(ctx)
    case 'mongodb':
      return new MongoAdapter(ctx)
    case 'demo':
      return new DemoAdapter()
  }
}

/** Creates and connects an adapter, routing it through an SSH tunnel when configured */
export async function connectAdapter(info: ConnectionInfo, password: string, sshSecret: string): Promise<DbAdapter> {
  const ssh = info.options.ssh
  if (!ssh?.enabled || info.kind === 'demo') {
    const adapter = createAdapter(info, password)
    await adapter.connect()
    return adapter
  }
  const tunnel = await openTunnel(ssh, sshSecret, info.host || '127.0.0.1', info.port)
  const adapter = createAdapter(
    { ...info, host: '127.0.0.1', port: tunnel.localPort, options: { ...info.options, uri: undefined } },
    password
  )
  try {
    await adapter.connect()
  } catch (err) {
    tunnel.close()
    throw err
  }
  const close = adapter.close.bind(adapter)
  adapter.close = async () => {
    await close()
    tunnel.close()
  }
  return adapter
}

const live = new Map<string, Promise<DbAdapter>>()

/** Returns a connected adapter for a saved connection, reusing an open one when possible */
export function adapterFor(connectionId: string): Promise<DbAdapter> {
  const existing = live.get(connectionId)
  if (existing) return existing
  const row = getConnection(connectionId)
  if (!row) return Promise.reject(new Error('Connection not found'))
  const p = connectAdapter(row.info, decryptSecret(row.secret), decryptSecret(row.sshSecret))
  live.set(connectionId, p)
  p.catch(() => live.delete(connectionId))
  return p
}

export async function dropAdapter(connectionId: string): Promise<void> {
  const p = live.get(connectionId)
  live.delete(connectionId)
  if (p) await p.then((a) => a.close()).catch(() => {})
}

export async function dropAll(): Promise<void> {
  await Promise.all([...live.keys()].map(dropAdapter))
}

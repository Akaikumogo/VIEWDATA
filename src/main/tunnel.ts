import { readFileSync } from 'node:fs'
import { type AddressInfo, type Server, createServer } from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'
import type { SshOptions } from '../shared/types'

export interface Tunnel {
  localPort: number
  close(): void
}

/**
 * Opens an SSH connection and a local TCP listener on 127.0.0.1 whose sockets
 * are forwarded to dstHost:dstPort as seen from the SSH server.
 */
export function openTunnel(ssh: SshOptions, secret: string, dstHost: string, dstPort: number): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let server: Server | null = null
    let settled = false

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      server?.close()
      client.end()
      reject(new Error(`SSH tunnel: ${err.message}`))
    }

    const config: ConnectConfig = {
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.username,
      readyTimeout: 15_000,
      keepaliveInterval: 20_000
    }
    if (ssh.auth === 'key') {
      if (!ssh.privateKeyPath) return fail(new Error('Private key file is not set'))
      try {
        config.privateKey = readFileSync(ssh.privateKeyPath)
      } catch (err) {
        return fail(new Error(`Cannot read private key: ${(err as Error).message}`))
      }
      if (secret) config.passphrase = secret
    } else {
      config.password = secret
    }

    client.on('error', fail)
    client.on('ready', () => {
      server = createServer((socket) => {
        client.forwardOut('127.0.0.1', socket.remotePort ?? 0, dstHost, dstPort, (err, stream) => {
          if (err) {
            socket.destroy()
            return
          }
          socket.pipe(stream).pipe(socket)
          socket.on('error', () => stream.close())
          stream.on('error', () => socket.destroy())
        })
      })
      server.on('error', fail)
      server.listen(0, '127.0.0.1', () => {
        settled = true
        const port = (server!.address() as AddressInfo).port
        resolve({
          localPort: port,
          close: () => {
            server?.close()
            client.end()
          }
        })
      })
    })
    client.connect(config)
  })
}

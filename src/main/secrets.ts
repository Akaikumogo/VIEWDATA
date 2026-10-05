import { safeStorage } from 'electron'

const ENC = 'enc:'
const RAW = 'raw:'

export function encryptSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return ENC + safeStorage.encryptString(plain).toString('base64')
  }
  return RAW + Buffer.from(plain, 'utf8').toString('base64')
}

export function decryptSecret(stored: string | null): string {
  if (!stored) return ''
  if (stored.startsWith(ENC)) {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC.length), 'base64'))
  }
  if (stored.startsWith(RAW)) {
    return Buffer.from(stored.slice(RAW.length), 'base64').toString('utf8')
  }
  return ''
}

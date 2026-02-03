import crypto from 'crypto'

import { getConfig } from '@/lib/config'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

/**
 * Encrypt sensitive data using AES-256-CBC
 * @param text Plain text to encrypt
 * @returns Encrypted text in format: iv:encryptedData
 */
export function encrypt(text: string): string {
  if (!text) return ''

  const config = getConfig()
  const key = crypto
    .createHash('sha256')
    .update(config.secretPhase)
    .digest()

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  return `${iv.toString('hex')}:${encrypted}`
}

/**
 * Decrypt encrypted data
 * @param text Encrypted text in format: iv:encryptedData
 * @returns Decrypted plain text
 */
export function decrypt(text: string): string {
  if (!text) return ''

  const config = getConfig()
  const key = crypto
    .createHash('sha256')
    .update(config.secretPhase)
    .digest()

  const [ivHex, encryptedHex] = text.split(':')
  if (!ivHex || !encryptedHex) {
    throw new Error('Invalid encrypted data format')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Generate random alphanumeric string
 * @param length Length of the string (default: 32)
 * @returns Random alphanumeric string (A-Za-z0-9)
 */
export function generateAlphanumeric(length: number = 32): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''

  const randomBytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length]
  }

  return result
}

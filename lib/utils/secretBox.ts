import crypto from 'node:crypto'

import { getConfig } from '@/lib/config'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32
const HKDF_SALT = Buffer.alloc(0)
const BASE64URL_NON_EMPTY = /^[A-Za-z0-9_-]+$/
const BASE64URL_OPTIONAL = /^[A-Za-z0-9_-]*$/

export const PDS_SIGNING_KEY_HKDF_INFO = 'activities.next/pds-signing-key/v1'
export const PDS_BLOB_STORAGE_KEY_HKDF_INFO =
  'activities.next/pds-blob-storage-key/v1'

export type SecretBoxOptions = {
  info: string
  aad?: string | Uint8Array
  secretPhase?: string
}

const toBuffer = (value: string | Uint8Array): Buffer =>
  typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength)

export const deriveSecretKey = ({
  info,
  secretPhase
}: {
  info: string
  secretPhase?: string
}): Buffer => {
  const resolvedSecret = secretPhase ?? getConfig().secretPhase
  if (!resolvedSecret) {
    throw new Error('ACTIVITIES_SECRET_PHASE is required for secret encryption')
  }
  if (!info) {
    throw new Error('HKDF info is required for secret key derivation')
  }
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(resolvedSecret, 'utf8'),
    HKDF_SALT,
    Buffer.from(info, 'utf8'),
    KEY_LENGTH
  )
  return Buffer.from(derived)
}

const buildAad = (version: string, aad?: string | Uint8Array): Buffer => {
  if (aad === undefined) {
    return Buffer.from(version, 'utf8')
  }
  return Buffer.concat([Buffer.from(`${version}|`, 'utf8'), toBuffer(aad)])
}

const decodeCanonicalBase64Url = (
  value: string,
  expectedLength?: number
): Buffer => {
  const pattern =
    expectedLength === undefined ? BASE64URL_OPTIONAL : BASE64URL_NON_EMPTY
  if (!pattern.test(value)) {
    throw new Error('Invalid secret box encoding')
  }
  const decoded = Buffer.from(value, 'base64url')
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error('Invalid secret box component length')
  }
  if (decoded.toString('base64url') !== value) {
    throw new Error('Non-canonical secret box encoding')
  }
  return decoded
}

/**
 * Encrypts a secret (UTF-8 string or raw bytes) using AES-256-GCM with a key
 * derived via HKDF-SHA256 from `ACTIVITIES_SECRET_PHASE`.
 *
 * Output format: `v1:<iv b64url>:<tag b64url>:<ct b64url>`.
 */
export const encryptSecret = (
  plaintext: string | Uint8Array,
  options: SecretBoxOptions
): string => {
  const key = deriveSecretKey({
    info: options.info,
    secretPhase: options.secretPhase
  })
  const iv = crypto.randomBytes(IV_LENGTH)
  const input = toBuffer(plaintext)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  })
  cipher.setAAD(buildAad(VERSION, options.aad))
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${VERSION}:${iv.toString('base64url')}:${authTag.toString('base64url')}:${ciphertext.toString('base64url')}`
}

/**
 * Decrypts a versioned AES-256-GCM secret envelope and returns raw bytes.
 */
export const decryptSecretBytes = (
  envelope: string,
  options: SecretBoxOptions
): Buffer => {
  const parts = envelope.split(':')
  if (parts.length !== 4) {
    throw new Error('Invalid secret box format')
  }

  const [version, ivPart, tagPart, ciphertextPart] = parts
  if (version !== VERSION) {
    throw new Error(`Unsupported secret box version: ${version}`)
  }

  const iv = decodeCanonicalBase64Url(ivPart, IV_LENGTH)
  const authTag = decodeCanonicalBase64Url(tagPart, AUTH_TAG_LENGTH)
  const ciphertext = decodeCanonicalBase64Url(ciphertextPart)

  const key = deriveSecretKey({
    info: options.info,
    secretPhase: options.secretPhase
  })

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  })
  decipher.setAAD(buildAad(VERSION, options.aad))
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Decrypts a versioned AES-256-GCM secret envelope as a UTF-8 string.
 */
export const decryptSecret = (
  envelope: string,
  options: SecretBoxOptions
): string => decryptSecretBytes(envelope, options).toString('utf8')

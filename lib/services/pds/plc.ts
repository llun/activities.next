import { type Secp256k1Keypair, verifySignature } from '@atproto/crypto'
import { encode as cborEncode } from '@atproto/lex-cbor'
import { type LexValue, cidForCbor } from '@atproto/lex-data'
import { createHash } from 'node:crypto'

import { getPlcDirectoryUrl } from '@/lib/config/blueskyPds'
import {
  type SafeRemoteFetch,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

/**
 * The `did:plc` method's operation format and a small directory client
 * (https://web.plc.directory/spec/v0.1/did-plc).
 *
 * This module imports `@atproto/*`, so it must stay out of any graph a script
 * loads as CommonJS (see lib/jobs/index.test.ts). The database layer and the
 * PDS modules it reaches never import it.
 */

export const PLC_DIRECTORY_TIMEOUT_MS = 15_000
export const PLC_DIRECTORY_MAX_BODY_BYTES = 64 * 1024

export type PlcService = {
  type: string
  endpoint: string
}

export type PlcUnsignedOperation = {
  type: 'plc_operation'
  /** Priority-ordered `did:key` rotation keys; the first has the most authority. */
  rotationKeys: string[]
  /** Service id (no `#`) to `did:key`, e.g. `{ atproto: 'did:key:…' }`. */
  verificationMethods: Record<string, string>
  /** Priority-ordered aliases, e.g. `['at://alice.example.com']`. */
  alsoKnownAs: string[]
  services: Record<string, PlcService>
  /** CID of the previous operation, or `null` for a genesis operation. */
  prev: string | null
}

export type PlcSignedOperation = PlcUnsignedOperation & {
  /** base64url (no padding) low-S compact ECDSA signature over the unsigned op. */
  sig: string
}

export type PlcData = {
  did: string
  rotationKeys: string[]
  verificationMethods: Record<string, string>
  alsoKnownAs: string[]
  services: Record<string, PlcService>
}

export type PlcClientOptions = {
  /** Defaults to `getPlcDirectoryUrl()`. Must be an https origin. */
  directory?: string
  fetch?: SafeRemoteFetch
  timeoutMs?: number
}

export class PlcDirectoryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly directoryMessage: string | null = null,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'PlcDirectoryError'
  }
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** RFC 4648 base32, lowercase, no padding. */
const base32Encode = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest())

/**
 * Copies only the operation's data fields, so a signed operation's `sig` is
 * never part of the bytes that get signed or hashed.
 */
const toUnsignedOperation = (
  operation: PlcUnsignedOperation | PlcSignedOperation
): PlcUnsignedOperation => ({
  type: 'plc_operation',
  rotationKeys: [...operation.rotationKeys],
  verificationMethods: { ...operation.verificationMethods },
  alsoKnownAs: [...operation.alsoKnownAs],
  services: Object.fromEntries(
    Object.entries(operation.services).map(([id, service]) => [
      id,
      { type: service.type, endpoint: service.endpoint }
    ])
  ),
  prev: operation.prev
})

const encodeUnsigned = (operation: PlcUnsignedOperation): Uint8Array =>
  cborEncode(toUnsignedOperation(operation) as LexValue)

const encodeSigned = (operation: PlcSignedOperation): Uint8Array =>
  cborEncode(operation as LexValue)

/**
 * DAG-CBOR-encodes the operation without `sig`, signs those bytes with the
 * keypair, and base64url-encodes the low-S compact signature into `sig`.
 */
export const signPlcOperation = async (
  unsigned: PlcUnsignedOperation,
  keypair: Secp256k1Keypair
): Promise<PlcSignedOperation> => {
  const bytes = encodeUnsigned(unsigned)
  const signature = await keypair.sign(bytes)
  return {
    ...toUnsignedOperation(unsigned),
    sig: Buffer.from(signature).toString('base64url')
  }
}

/**
 * `did:plc:` plus the first 24 characters of the lowercase base32 (no padding)
 * SHA-256 of the DAG-CBOR-encoded signed genesis operation.
 */
export const didForGenesisOperation = async (
  signedOperation: PlcSignedOperation
): Promise<string> => {
  const digest = sha256(encodeSigned(signedOperation))
  return `did:plc:${base32Encode(digest).slice(0, 24)}`
}

/**
 * The CIDv1 dag-cbor sha256 of the signed operation, as a string, for the next
 * operation's `prev`.
 */
export const cidForOperation = async (
  signedOperation: PlcSignedOperation
): Promise<string> => {
  const cid = await cidForCbor(encodeSigned(signedOperation))
  return cid.toString()
}

export type CreateGenesisOperationParams = {
  rotationKeys: string[]
  signingKeyDid: string
  handle: string
  pdsEndpoint: string
  rotationKeypair: Secp256k1Keypair
}

/**
 * Builds and signs a genesis operation, and derives the DID from it. The
 * signing keypair must be one of `rotationKeys`.
 */
export const createGenesisOperation = async ({
  rotationKeys,
  signingKeyDid,
  handle,
  pdsEndpoint,
  rotationKeypair
}: CreateGenesisOperationParams): Promise<{
  did: string
  operation: PlcSignedOperation
}> => {
  if (!rotationKeys.includes(rotationKeypair.did())) {
    throw new Error('The rotation keypair must be one of the rotation keys')
  }

  const operation = await signPlcOperation(
    {
      type: 'plc_operation',
      rotationKeys: [...rotationKeys],
      verificationMethods: { atproto: signingKeyDid },
      alsoKnownAs: [`at://${handle}`],
      services: {
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: pdsEndpoint
        }
      },
      prev: null
    },
    rotationKeypair
  )

  return { did: await didForGenesisOperation(operation), operation }
}

export type PlcOperationChanges = Partial<
  Pick<
    PlcUnsignedOperation,
    'rotationKeys' | 'verificationMethods' | 'alsoKnownAs' | 'services'
  >
>

/**
 * Copies the previous operation, applies `changes`, points `prev` at
 * `previousCid`, and signs the result with the rotation keypair.
 */
export const createUpdateOperation = async ({
  previous,
  previousCid,
  changes,
  rotationKeypair
}: {
  previous: PlcSignedOperation
  previousCid: string
  changes: PlcOperationChanges
  rotationKeypair: Secp256k1Keypair
}): Promise<PlcSignedOperation> =>
  signPlcOperation(
    {
      ...toUnsignedOperation(previous),
      ...changes,
      prev: previousCid
    },
    rotationKeypair
  )

/**
 * Verifies the operation's `sig` against any of `didKeys` (the rotation keys
 * that were valid for the previous operation).
 */
export const verifyPlcOperationSignature = async (
  operation: PlcSignedOperation,
  didKeys: string[]
): Promise<boolean> => {
  const bytes = encodeUnsigned(operation)
  const signature = Buffer.from(operation.sig, 'base64url')
  for (const didKey of didKeys) {
    if (await verifySignature(didKey, bytes, signature)) {
      return true
    }
  }
  return false
}

const PLC_DID_PATTERN = /^did:plc:[a-z2-7]+$/

const assertPlcDid = (did: string): void => {
  if (!PLC_DID_PATTERN.test(did)) {
    throw new PlcDirectoryError(`Invalid did:plc identifier: ${did}`, 0)
  }
}

const resolveDirectory = (directory: string): string => {
  let parsed: URL
  try {
    parsed = new URL(directory)
  } catch {
    throw new PlcDirectoryError('PLC directory must be an https origin', 0)
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new PlcDirectoryError('PLC directory must be an https origin', 0)
  }
  return parsed.origin
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isPlcSignedOperation = (value: unknown): value is PlcSignedOperation => {
  if (!isRecord(value)) return false
  if (value.type !== 'plc_operation') return false
  if (!isStringArray(value.rotationKeys)) return false
  if (!isStringArray(value.alsoKnownAs)) return false
  if (typeof value.sig !== 'string') return false
  if (value.prev !== null && typeof value.prev !== 'string') return false
  if (!isRecord(value.verificationMethods)) return false
  if (!isRecord(value.services)) return false
  return true
}

const isPlcData = (value: unknown): value is PlcData => {
  if (!isRecord(value)) return false
  if (typeof value.did !== 'string') return false
  if (!isStringArray(value.rotationKeys)) return false
  if (!isStringArray(value.alsoKnownAs)) return false
  if (!isRecord(value.verificationMethods)) return false
  if (!isRecord(value.services)) return false
  return true
}

const directoryMessageFromBody = (body: string): string | null => {
  const trimmed = body.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed)) {
      for (const key of ['error', 'message']) {
        const value = parsed[key]
        if (typeof value === 'string' && value) return value
      }
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return trimmed.slice(0, 500)
}

const assertOk = (
  response: { statusCode: number; body: string },
  action: string
): void => {
  if (response.statusCode >= 200 && response.statusCode < 300) return
  const directoryMessage = directoryMessageFromBody(response.body)
  throw new PlcDirectoryError(
    directoryMessage
      ? `PLC directory refused ${action} (${response.statusCode}): ${directoryMessage}`
      : `PLC directory refused ${action} (${response.statusCode})`,
    response.statusCode,
    directoryMessage
  )
}

const request = async ({
  url,
  method,
  body,
  options
}: {
  url: string
  method: 'GET' | 'POST'
  body?: string
  options: PlcClientOptions
}): Promise<{ statusCode: number; body: string }> => {
  const fetch = options.fetch ?? safeRemoteFetch
  try {
    const response = await fetch({
      url,
      method,
      maxRedirects: 0,
      maxBodyBytes: PLC_DIRECTORY_MAX_BODY_BYTES,
      timeoutInMilliseconds: options.timeoutMs ?? PLC_DIRECTORY_TIMEOUT_MS,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body }
        : {})
    })
    return { statusCode: response.statusCode, body: response.body }
  } catch (error) {
    // DNS, connection and timeout failures are the directory being
    // unreachable too, so callers see one error type for every directory fault.
    throw new PlcDirectoryError('PLC directory could not be reached', 0, null, {
      cause: error
    })
  }
}

const parseJson = (body: string, what: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    throw new PlcDirectoryError(
      `PLC directory returned invalid JSON for ${what}`,
      0
    )
  }
}

/** POSTs a signed operation to `${directory}/${did}`. */
export const submitPlcOperation = async (
  did: string,
  operation: PlcSignedOperation,
  options: PlcClientOptions = {}
): Promise<void> => {
  const directory = resolveDirectory(options.directory ?? getPlcDirectoryUrl())
  assertPlcDid(did)
  const response = await request({
    url: `${directory}/${did}`,
    method: 'POST',
    body: JSON.stringify(operation),
    options
  })
  assertOk(response, `operation for ${did}`)
}

/** GETs `${directory}/${did}/log/last`, the most recent signed operation. */
export const getLastPlcOperation = async (
  did: string,
  options: PlcClientOptions = {}
): Promise<PlcSignedOperation> => {
  const directory = resolveDirectory(options.directory ?? getPlcDirectoryUrl())
  assertPlcDid(did)
  const response = await request({
    url: `${directory}/${did}/log/last`,
    method: 'GET',
    options
  })
  assertOk(response, `last operation for ${did}`)
  const parsed = parseJson(response.body, `last operation for ${did}`)
  if (!isPlcSignedOperation(parsed)) {
    throw new PlcDirectoryError(
      `PLC directory returned an invalid operation for ${did}`,
      0
    )
  }
  return parsed
}

/** GETs `${directory}/${did}/data`, the current PLC state. */
export const getPlcData = async (
  did: string,
  options: PlcClientOptions = {}
): Promise<PlcData> => {
  const directory = resolveDirectory(options.directory ?? getPlcDirectoryUrl())
  assertPlcDid(did)
  const response = await request({
    url: `${directory}/${did}/data`,
    method: 'GET',
    options
  })
  assertOk(response, `data for ${did}`)
  const parsed = parseJson(response.body, `data for ${did}`)
  if (!isPlcData(parsed)) {
    throw new PlcDirectoryError(
      `PLC directory returned invalid data for ${did}`,
      0
    )
  }
  return parsed
}

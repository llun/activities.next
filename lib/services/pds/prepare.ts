import { TID } from '@atproto/common'
import { encode as cborEncode } from '@atproto/lex-cbor'
import {
  type Cid,
  type LexMap,
  type LexValue,
  type TypedBlobRef,
  cidForCbor,
  enumBlobRefs,
  isCid,
  isLegacyBlobRef,
  isPlainObject
} from '@atproto/lex-data'
import { jsonToLex } from '@atproto/lex-json'
import {
  type RecordCreateOp,
  type RecordDeleteOp,
  type RecordUpdateOp,
  type RecordWriteOp,
  WriteOpAction
} from '@atproto/repo'
import {
  AtUri,
  type NsidString,
  isValidNsid,
  isValidRecordKey
} from '@atproto/syntax'

import { MAX_PDS_RECORD_SIZE_BYTES } from './constants'
import { PdsValidationError } from './errors'

export type PdsCreateWriteInput = {
  action: 'create'
  collection: string
  rkey?: string
  record: Record<string, unknown>
}

export type PdsUpdateWriteInput = {
  action: 'update'
  collection: string
  rkey: string
  record: Record<string, unknown>
}

export type PdsDeleteWriteInput = {
  action: 'delete'
  collection: string
  rkey: string
}

export type PdsWriteInput =
  PdsCreateWriteInput | PdsUpdateWriteInput | PdsDeleteWriteInput

export type PreparedPdsCreate = {
  action: WriteOpAction.Create
  collection: NsidString
  rkey: string
  uri: string
  cid: Cid
  record: LexMap
  blobCids: string[]
  blobs: TypedBlobRef[]
}

export type PreparedPdsUpdate = {
  action: WriteOpAction.Update
  collection: NsidString
  rkey: string
  uri: string
  cid: Cid
  record: LexMap
  blobCids: string[]
  blobs: TypedBlobRef[]
}

export type PreparedPdsDelete = {
  action: WriteOpAction.Delete
  collection: NsidString
  rkey: string
  uri: string
}

export type PreparedPdsWrite =
  PreparedPdsCreate | PreparedPdsUpdate | PreparedPdsDelete

/**
 * Normalizes a JS/JSON record value into a strict ATProto LexValue, accepting
 * either already-Lex values (`Cid`, `Uint8Array`) or JSON-encoded `$link` /
 * `$bytes` objects while rejecting floats, non-plain objects, and invalid links.
 */
export const normalizeRecordToLex = (value: unknown): LexValue => {
  if (value === null) return null
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new PdsValidationError(
        `Non-integer numbers (${value}) are not supported by the AT Data Model`
      )
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new PdsValidationError(
      `Unsupported value type in record: ${typeof value}`
    )
  }

  if (isCid(value)) {
    return value
  }
  if (value instanceof Uint8Array) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRecordToLex(item))
  }
  if (!isPlainObject(value)) {
    throw new PdsValidationError('Record values must be plain objects')
  }

  const recordObj = value as Record<string, unknown>
  if ('$link' in recordObj || '$bytes' in recordObj) {
    try {
      return jsonToLex(recordObj as Parameters<typeof jsonToLex>[0], {
        strict: true
      })
    } catch (error) {
      throw new PdsValidationError(
        error instanceof Error
          ? error.message
          : 'Invalid $link or $bytes value',
        'InvalidRequest',
        { cause: error }
      )
    }
  }

  const result: LexMap = {}
  for (const [key, entry] of Object.entries(recordObj)) {
    if (key === '__proto__') {
      throw new PdsValidationError('Invalid record property: __proto__')
    }
    if (entry === undefined) continue
    result[key] = normalizeRecordToLex(entry)
  }
  return result
}

const prepareRecordPayload = async ({
  did,
  collection,
  rkey,
  record
}: {
  did: string
  collection: string
  rkey: string
  record: Record<string, unknown>
}): Promise<{
  uri: string
  cid: Cid
  lexRecord: LexMap
  blobs: TypedBlobRef[]
  blobCids: string[]
}> => {
  if (!isPlainObject(record)) {
    throw new PdsValidationError('Record must be a plain object')
  }

  const normalized = normalizeRecordToLex(record)
  if (!isPlainObject(normalized)) {
    throw new PdsValidationError('Record must be a plain object')
  }
  const lexRecord = normalized as LexMap

  if (lexRecord.$type !== collection) {
    throw new PdsValidationError(
      `Invalid record $type: expected ${collection}, got ${String(lexRecord.$type)}`
    )
  }

  // Record body lexicon validation beyond $type is out of scope for D2.1 (only the app writes).

  let encoded: Uint8Array
  try {
    encoded = cborEncode(lexRecord)
  } catch (error) {
    throw new PdsValidationError(
      error instanceof Error
        ? error.message
        : 'Record failed DAG-CBOR encoding',
      'InvalidRequest',
      { cause: error }
    )
  }

  if (encoded.byteLength > MAX_PDS_RECORD_SIZE_BYTES) {
    throw new PdsValidationError(
      `Encoded record size ${encoded.byteLength} bytes exceeds maximum of ${MAX_PDS_RECORD_SIZE_BYTES} bytes`
    )
  }

  const blobs: TypedBlobRef[] = []
  for (const blob of enumBlobRefs(lexRecord, {
    strict: false,
    allowLegacy: true
  })) {
    if (isLegacyBlobRef(blob)) {
      throw new PdsValidationError(`Legacy blobs are not allowed (${blob.cid})`)
    }
    blobs.push(blob)
  }

  const blobCids = Array.from(new Set(blobs.map((blob) => blob.ref.toString())))
  const cid = await cidForCbor(encoded)
  const uri = AtUri.make(did, collection, rkey).toString()

  return { uri, cid, lexRecord, blobs, blobCids }
}

export const preparePdsWrite = async ({
  did,
  write
}: {
  did: string
  write: PdsWriteInput
}): Promise<PreparedPdsWrite> => {
  if (!isValidNsid(write.collection)) {
    throw new PdsValidationError(`Invalid collection NSID: ${write.collection}`)
  }
  const collection = write.collection as NsidString

  if (write.action === 'create') {
    if (write.rkey !== undefined && !isValidRecordKey(write.rkey)) {
      throw new PdsValidationError(`Invalid record key: ${write.rkey}`)
    }
    const rkey = write.rkey ?? TID.nextStr()
    const prepared = await prepareRecordPayload({
      did,
      collection,
      rkey,
      record: write.record
    })
    return {
      action: WriteOpAction.Create,
      collection,
      rkey,
      uri: prepared.uri,
      cid: prepared.cid,
      record: prepared.lexRecord,
      blobs: prepared.blobs,
      blobCids: prepared.blobCids
    }
  }

  if (write.action === 'update') {
    if (!write.rkey || !isValidRecordKey(write.rkey)) {
      throw new PdsValidationError(`Invalid record key: ${write.rkey}`)
    }
    const prepared = await prepareRecordPayload({
      did,
      collection,
      rkey: write.rkey,
      record: write.record
    })
    return {
      action: WriteOpAction.Update,
      collection,
      rkey: write.rkey,
      uri: prepared.uri,
      cid: prepared.cid,
      record: prepared.lexRecord,
      blobs: prepared.blobs,
      blobCids: prepared.blobCids
    }
  }

  if (write.action === 'delete') {
    if (!write.rkey || !isValidRecordKey(write.rkey)) {
      throw new PdsValidationError(`Invalid record key: ${write.rkey}`)
    }
    return {
      action: WriteOpAction.Delete,
      collection,
      rkey: write.rkey,
      uri: AtUri.make(did, collection, write.rkey).toString()
    }
  }

  throw new PdsValidationError(
    `Unsupported write action: ${String((write as { action?: unknown }).action)}`
  )
}

export const preparedWriteToRepoOp = (
  write: PreparedPdsWrite
): RecordWriteOp => {
  switch (write.action) {
    case WriteOpAction.Create:
      return {
        action: WriteOpAction.Create,
        collection: write.collection,
        rkey: write.rkey,
        record: write.record
      } satisfies RecordCreateOp
    case WriteOpAction.Update:
      return {
        action: WriteOpAction.Update,
        collection: write.collection,
        rkey: write.rkey,
        record: write.record
      } satisfies RecordUpdateOp
    case WriteOpAction.Delete:
      return {
        action: WriteOpAction.Delete,
        collection: write.collection,
        rkey: write.rkey
      } satisfies RecordDeleteOp
  }
}

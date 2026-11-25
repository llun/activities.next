import { decode as cborDecode, encode as cborEncode } from '@atproto/lex-cbor'
import type { LexMap } from '@atproto/lex-data'

import type { PdsEvent, PdsEventType } from '@/lib/database/domains/pds/types'

export type PdsFirehoseEventFrameType = `#${PdsEventType}`
export type PdsFirehoseMessageType = PdsFirehoseEventFrameType | '#info'
export type PdsFirehoseInfoName = 'OutdatedCursor' | (string & {})
export type PdsFirehoseErrorName =
  'FutureCursor' | 'ConsumerTooSlow' | (string & {})

export type PdsFirehoseMessageHeader = {
  op: 1
  t: PdsFirehoseMessageType
}

export type PdsFirehoseErrorHeader = {
  op: -1
}

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

const isLexMap = (value: unknown): value is LexMap =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array)

const encodeMessageFrame = (
  t: PdsFirehoseMessageType,
  body: LexMap
): Uint8Array => {
  const header: PdsFirehoseMessageHeader = { op: 1, t }
  return concatBytes(cborEncode(header), cborEncode(body))
}

/**
 * Encodes a stored `pds_events` row as an ATProto event-stream message frame:
 * `DAG-CBOR({ op: 1, t: '#<type>' }) || DAG-CBOR({ ...payload, seq })`.
 */
export const encodeEventFrame = (row: PdsEvent): Uint8Array => {
  const decoded = cborDecode(row.payload)
  if (!isLexMap(decoded)) {
    throw new Error(
      `Invalid PDS event payload for seq ${row.seq}: expected CBOR map`
    )
  }
  const body: LexMap = {
    ...decoded,
    seq: row.seq
  }
  return encodeMessageFrame(`#${row.type}`, body)
}

/**
 * Encodes an ATProto `#info` event-stream frame (e.g. `OutdatedCursor`).
 */
export const encodeInfoFrame = (
  name: PdsFirehoseInfoName,
  message?: string
): Uint8Array => {
  const body: LexMap = message !== undefined ? { name, message } : { name }
  return encodeMessageFrame('#info', body)
}

/**
 * Encodes an ATProto error event-stream frame (`op: -1`, e.g. `FutureCursor`,
 * `ConsumerTooSlow`).
 */
export const encodeErrorFrame = (
  error: PdsFirehoseErrorName,
  message?: string
): Uint8Array => {
  const header: PdsFirehoseErrorHeader = { op: -1 }
  const body: LexMap = message !== undefined ? { error, message } : { error }
  return concatBytes(cborEncode(header), cborEncode(body))
}

import { decode as cborDecode, encode as cborEncode } from '@atproto/lex-cbor'
import type { Cid, LexMap, LexValue } from '@atproto/lex-data'
import { BlockMap, type CommitData, blocksToCarFile } from '@atproto/repo'

import type { PdsEvent, PdsRepoStatus } from '@/lib/database/domains/pds/types'

import { MAX_PDS_COMMIT_BYTES } from './constants'
import { PdsValidationError } from './errors'

export type PdsCommitEventOp = {
  action: 'create' | 'update' | 'delete'
  path: string
  cid: Cid | null
  prev?: Cid
}

export type DecodedPdsCommitEvent = {
  type: 'commit'
  seq: number
  time: string
  repo: string
  commit: Cid
  rev: string
  since: string | null
  blocks: Uint8Array
  ops: PdsCommitEventOp[]
  prevData?: Cid
  rebase: boolean
  tooBig: boolean
  blobs: Cid[]
}

export type DecodedPdsIdentityEvent = {
  type: 'identity'
  seq: number
  time: string
  did: string
  handle?: string
}

export type DecodedPdsAccountEvent = {
  type: 'account'
  seq: number
  time: string
  did: string
  active: boolean
  status?: Exclude<PdsRepoStatus, 'active'> | 'deleted' | 'suspended'
}

export type DecodedPdsSyncEvent = {
  type: 'sync'
  seq: number
  time: string
  did: string
  rev: string
  blocks: Uint8Array
}

export type DecodedPdsEvent =
  | DecodedPdsCommitEvent
  | DecodedPdsIdentityEvent
  | DecodedPdsAccountEvent
  | DecodedPdsSyncEvent

/**
 * Formats a sync-1.1 `#commit` event payload as strict ATProto DAG-CBOR,
 * including both new blocks and MST inversion-proof blocks plus `prevData` and
 * per-op `prev` CIDs so relays can verify and invert the commit.
 */
export const formatPdsCommitEvent = async ({
  did,
  commitData,
  ops,
  prevData,
  time = new Date().toISOString()
}: {
  did: string
  commitData: CommitData
  ops: PdsCommitEventOp[]
  prevData: Cid | null
  time?: string
}): Promise<Uint8Array> => {
  const blocksToSend = new BlockMap()
  blocksToSend.addMap(commitData.newBlocks)
  blocksToSend.addMap(commitData.relevantBlocks)

  const encodedOps: LexValue[] = ops.map((op) => {
    const entry: LexMap = {
      action: op.action,
      path: op.path,
      cid: op.cid
    }
    if (op.prev) {
      entry.prev = op.prev
    }
    return entry
  })

  const blocksCar = await blocksToCarFile(commitData.cid, blocksToSend)
  if (blocksCar.byteLength > MAX_PDS_COMMIT_BYTES) {
    throw new PdsValidationError(
      `Commit blocks CAR (${blocksCar.byteLength} bytes) exceeds maximum size of ${MAX_PDS_COMMIT_BYTES} bytes`
    )
  }

  const payload: LexMap = {
    repo: did,
    commit: commitData.cid,
    rev: commitData.rev,
    since: commitData.since,
    blocks: blocksCar,
    ops: encodedOps,
    rebase: false,
    tooBig: false,
    blobs: [],
    time
  }
  if (prevData) {
    payload.prevData = prevData
  }

  return cborEncode(payload)
}

export const formatPdsIdentityEvent = ({
  did,
  handle,
  time = new Date().toISOString()
}: {
  did: string
  handle?: string
  time?: string
}): Uint8Array => {
  const payload: LexMap = { did, time }
  if (handle) {
    payload.handle = handle
  }
  return cborEncode(payload)
}

export const formatPdsAccountEvent = ({
  did,
  active,
  status,
  time = new Date().toISOString()
}: {
  did: string
  active: boolean
  status?: Exclude<PdsRepoStatus, 'active'> | 'deleted' | 'suspended'
  time?: string
}): Uint8Array => {
  const payload: LexMap = { did, active, time }
  if (!active && status) {
    payload.status = status
  }
  return cborEncode(payload)
}

/**
 * Decodes a stored `pds_events` row into a typed sync-1.1 event with its
 * assigned sequence number and ISO timestamp.
 */
export const decodePdsEvent = (row: PdsEvent): DecodedPdsEvent => {
  const decoded = cborDecode(row.payload) as LexMap
  const time =
    typeof decoded.time === 'string'
      ? decoded.time
      : new Date(row.createdAt).toISOString()

  switch (row.type) {
    case 'commit':
      return {
        type: 'commit',
        seq: row.seq,
        time,
        repo: decoded.repo as string,
        commit: decoded.commit as Cid,
        rev: decoded.rev as string,
        since: (decoded.since as string | null) ?? null,
        blocks: decoded.blocks as Uint8Array,
        ops: (decoded.ops as PdsCommitEventOp[]) ?? [],
        ...(decoded.prevData ? { prevData: decoded.prevData as Cid } : {}),
        rebase: Boolean(decoded.rebase),
        tooBig: Boolean(decoded.tooBig),
        blobs: (decoded.blobs as Cid[]) ?? []
      }
    case 'identity':
      return {
        type: 'identity',
        seq: row.seq,
        time,
        did: decoded.did as string,
        ...(typeof decoded.handle === 'string'
          ? { handle: decoded.handle }
          : {})
      }
    case 'account':
      return {
        type: 'account',
        seq: row.seq,
        time,
        did: decoded.did as string,
        active: Boolean(decoded.active),
        ...(typeof decoded.status === 'string'
          ? {
              status: decoded.status as DecodedPdsAccountEvent['status']
            }
          : {})
      }
    case 'sync':
      return {
        type: 'sync',
        seq: row.seq,
        time,
        did: decoded.did as string,
        rev: decoded.rev as string,
        blocks: decoded.blocks as Uint8Array
      }
  }
}

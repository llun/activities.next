import {
  decode as cborDecode,
  decodeAll as cborDecodeAll,
  encode as cborEncode,
  cidForLex
} from '@atproto/lex-cbor'
import type { LexMap } from '@atproto/lex-data'

import type { PdsEvent } from '@/lib/database/domains/pds/types'
import {
  formatPdsAccountEvent,
  formatPdsIdentityEvent
} from '@/lib/services/pds/events'

import { encodeErrorFrame, encodeEventFrame, encodeInfoFrame } from './frames'

const decodeFrame = (bytes: Uint8Array): [LexMap, LexMap] => {
  const items = Array.from(cborDecodeAll(bytes))
  expect(items).toHaveLength(2)
  return items as [LexMap, LexMap]
}

describe('PDS firehose frames', () => {
  it('encodes a #commit event frame with stored payload fields plus seq (preserving CIDs and bytes)', async () => {
    const commitCid = await cidForLex({ hello: 'commit' })
    const prevDataCid = await cidForLex({ hello: 'prev-mst' })
    const recordCid = await cidForLex({
      $type: 'app.bsky.feed.post',
      text: 'hi'
    })
    const blocks = new Uint8Array([0x0a, 0x0b, 0x0c, 0x0d])
    const storedPayloadMap: LexMap = {
      repo: 'did:web:alice.example.com',
      commit: commitCid,
      rev: '3k00000000001',
      since: null,
      blocks,
      ops: [
        {
          action: 'create',
          path: 'app.bsky.feed.post/3k1',
          cid: recordCid
        }
      ],
      prevData: prevDataCid,
      rebase: false,
      tooBig: false,
      blobs: [],
      time: '2026-11-25T00:00:00.000Z'
    }
    const storedPayload = cborEncode(storedPayloadMap)

    const row: PdsEvent = {
      seq: 42,
      did: 'did:web:alice.example.com',
      type: 'commit',
      payload: Buffer.from(storedPayload),
      createdAt: Date.UTC(2026, 10, 25, 0, 0, 0)
    }

    const frame = encodeEventFrame(row)
    const [header, body] = decodeFrame(frame)

    expect(header).toEqual({ op: 1, t: '#commit' })
    expect(body).toEqual({
      ...(cborDecode(storedPayload) as LexMap),
      seq: 42
    })
    expect(body.commit).toEqual(commitCid)
    expect(body.prevData).toEqual(prevDataCid)
    expect(body.blocks).toEqual(blocks)
  })

  it('encodes #identity, #account, and #sync event frames', () => {
    const identityRow: PdsEvent = {
      seq: 1,
      did: 'did:web:alice.example.com',
      type: 'identity',
      payload: Buffer.from(
        formatPdsIdentityEvent({
          did: 'did:web:alice.example.com',
          handle: 'alice.example.com',
          time: '2026-11-25T00:00:00.000Z'
        })
      ),
      createdAt: Date.UTC(2026, 10, 25)
    }
    expect(decodeFrame(encodeEventFrame(identityRow))).toEqual([
      { op: 1, t: '#identity' },
      {
        seq: 1,
        did: 'did:web:alice.example.com',
        handle: 'alice.example.com',
        time: '2026-11-25T00:00:00.000Z'
      }
    ])

    const accountRow: PdsEvent = {
      seq: 2,
      did: 'did:web:alice.example.com',
      type: 'account',
      payload: Buffer.from(
        formatPdsAccountEvent({
          did: 'did:web:alice.example.com',
          active: false,
          status: 'deactivated',
          time: '2026-11-25T00:01:00.000Z'
        })
      ),
      createdAt: Date.UTC(2026, 10, 25)
    }
    expect(decodeFrame(encodeEventFrame(accountRow))).toEqual([
      { op: 1, t: '#account' },
      {
        seq: 2,
        did: 'did:web:alice.example.com',
        active: false,
        status: 'deactivated',
        time: '2026-11-25T00:01:00.000Z'
      }
    ])

    const syncRow: PdsEvent = {
      seq: 3,
      did: 'did:web:alice.example.com',
      type: 'sync',
      payload: Buffer.from(
        cborEncode({
          did: 'did:web:alice.example.com',
          rev: '3k00000000002',
          blocks: new Uint8Array([1, 2, 3]),
          time: '2026-11-25T00:02:00.000Z'
        })
      ),
      createdAt: Date.UTC(2026, 10, 25)
    }
    expect(decodeFrame(encodeEventFrame(syncRow))).toEqual([
      { op: 1, t: '#sync' },
      {
        seq: 3,
        did: 'did:web:alice.example.com',
        rev: '3k00000000002',
        blocks: new Uint8Array([1, 2, 3]),
        time: '2026-11-25T00:02:00.000Z'
      }
    ])
  })

  it('encodes #info frames with and without message', () => {
    expect(decodeFrame(encodeInfoFrame('OutdatedCursor'))).toEqual([
      { op: 1, t: '#info' },
      { name: 'OutdatedCursor' }
    ])

    expect(
      decodeFrame(
        encodeInfoFrame('OutdatedCursor', 'Cursor older than retained events')
      )
    ).toEqual([
      { op: 1, t: '#info' },
      { name: 'OutdatedCursor', message: 'Cursor older than retained events' }
    ])
  })

  it('encodes error frames with op -1, with and without message', () => {
    expect(decodeFrame(encodeErrorFrame('FutureCursor'))).toEqual([
      { op: -1 },
      { error: 'FutureCursor' }
    ])

    expect(
      decodeFrame(
        encodeErrorFrame('ConsumerTooSlow', 'Buffered bytes exceeded 8 MiB')
      )
    ).toEqual([
      { op: -1 },
      { error: 'ConsumerTooSlow', message: 'Buffered bytes exceeded 8 MiB' }
    ])
  })
})

import { MAX_PDS_COLLECTIONS_LIMIT } from '@/lib/database/domains/pds/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  PDS_EVENTS_APPEND_LOCK_KEY,
  PDS_EVENTS_NOTIFY_CHANNEL
} from '@/lib/services/pds/constants'
import {
  PDS_FIREHOSE_PAGE_MAX_BYTES,
  PDS_FIREHOSE_PAGE_SIZE
} from '@/lib/services/pds/firehose/subscriber'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

describe('PDS database domain', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const createLocalActor = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    return `https://${TEST_DOMAIN}/users/${username}`
  }

  it('creates, fetches, lists with cursor, keeps signingKey off default selects, and updates repo status', async () => {
    const repoA = await database.createPdsRepo({
      did: 'did:web:a.pds.example',
      actorId: 'https://a.example/users/alice',
      domain: 'a.example',
      signingKey: 'v1:encrypted-a',
      signingKeyDid: 'did:key:zQ3shKeyA'
    })
    const repoB = await database.createPdsRepo({
      did: 'did:web:b.pds.example',
      actorId: 'https://a.example/users/bob',
      domain: 'a.example',
      signingKey: 'v1:encrypted-b',
      signingKeyDid: 'did:key:zQ3shKeyB',
      rootCid: 'bafyrootb',
      rev: '3k00000000001'
    })
    await database.createPdsRepo({
      did: 'did:web:c.pds.example',
      actorId: 'https://b.example/users/carol',
      domain: 'b.example',
      signingKey: 'v1:encrypted-c',
      signingKeyDid: 'did:key:zQ3shKeyC'
    })

    expect(repoA).toMatchObject({
      did: 'did:web:a.pds.example',
      actorId: 'https://a.example/users/alice',
      domain: 'a.example',
      signingKeyDid: 'did:key:zQ3shKeyA',
      rootCid: null,
      rev: null,
      status: 'active'
    })
    expect('signingKey' in repoA).toBe(false)

    const fetchedA = await database.getPdsRepo({ did: 'did:web:a.pds.example' })
    expect(fetchedA).toMatchObject({
      actorId: 'https://a.example/users/alice',
      signingKeyDid: 'did:key:zQ3shKeyA'
    })
    expect(fetchedA && 'signingKey' in fetchedA).toBe(false)
    expect(
      await database.getPdsRepoSigningKey({ did: 'did:web:a.pds.example' })
    ).toBe('v1:encrypted-a')
    expect(
      await database.getPdsRepoSigningKey({
        did: 'did:web:missing.pds.example'
      })
    ).toBeNull()

    expect(
      await database.getPdsRepo({ actorId: 'https://a.example/users/bob' })
    ).toMatchObject({
      did: repoB.did,
      signingKeyDid: 'did:key:zQ3shKeyB',
      rootCid: 'bafyrootb',
      rev: '3k00000000001'
    })
    expect(
      await database.getPdsRepo({ did: 'did:web:missing.pds.example' })
    ).toBeNull()

    const page1 = await database.listPdsRepos({
      domain: 'a.example',
      limit: 1
    })
    expect(page1.repos.map((r) => r.did)).toEqual(['did:web:a.pds.example'])
    expect('signingKey' in page1.repos[0]).toBe(false)
    expect(page1.cursor).toBe('did:web:a.pds.example')

    const page2 = await database.listPdsRepos({
      domain: 'a.example',
      cursor: page1.cursor,
      limit: 1
    })
    expect(page2.repos.map((r) => r.did)).toEqual(['did:web:b.pds.example'])
    expect(page2.cursor).toBeUndefined()

    expect(
      await database.updatePdsRepoStatus({
        did: repoA.did,
        status: 'deactivated'
      })
    ).toBe(true)
    expect((await database.getPdsRepo({ did: repoA.did }))?.status).toBe(
      'deactivated'
    )
    expect(
      await database.updatePdsRepoStatus({
        did: 'did:web:nope',
        status: 'takendown'
      })
    ).toBe(false)
  })

  it('enforces optimistic head updates with expectedRev', async () => {
    const did = 'did:web:head.pds.example'
    await database.createPdsRepo({
      did,
      actorId: 'https://head.example/users/alice',
      domain: 'head.example',
      signingKey: 'v1:key',
      signingKeyDid: 'did:key:zQ3shHead'
    })

    // Wrong expected rev (non-null while current is null) fails.
    expect(
      await database.updatePdsRepoHead({
        did,
        rootCid: 'bafy1',
        rev: '3k00000000010',
        expectedRev: '3k00000000000'
      })
    ).toBe(false)

    // Matching null expected rev succeeds.
    expect(
      await database.updatePdsRepoHead({
        did,
        rootCid: 'bafy1',
        rev: '3k00000000010',
        expectedRev: null
      })
    ).toBe(true)

    // Stale null expected rev now fails.
    expect(
      await database.updatePdsRepoHead({
        did,
        rootCid: 'bafy2',
        rev: '3k00000000020',
        expectedRev: null
      })
    ).toBe(false)

    // Matching current rev succeeds.
    expect(
      await database.updatePdsRepoHead({
        did,
        rootCid: 'bafy2',
        rev: '3k00000000020',
        expectedRev: '3k00000000010'
      })
    ).toBe(true)

    expect(await database.getPdsRepo({ did })).toMatchObject({
      rootCid: 'bafy2',
      rev: '3k00000000020'
    })
  })

  it('round-trips arbitrary binary bytes in blocks and events, including Uint8Array slices', async () => {
    const did = 'did:web:bin.pds.example'
    const fullByteRange = Uint8Array.from({ length: 256 }, (_, i) => i)
    // Backing buffer larger than the view to verify byteOffset/byteLength handling.
    const backing = new Uint8Array(20)
    backing.fill(0xaa)
    backing.set([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff], 5)
    const sliceView = new Uint8Array(backing.buffer, 5, 6)

    await database.putPdsBlocks({
      did,
      blocks: [
        { cid: 'bafy-01', bytes: fullByteRange, repoRev: 'rev-1' },
        { cid: 'bafy-02', bytes: sliceView, repoRev: 'rev-2' }
      ]
    })

    // Duplicate insert with a newer repoRev preserves original bytes and advances repoRev.
    await database.putPdsBlocks({
      did,
      blocks: [
        {
          cid: 'bafy-02',
          bytes: new Uint8Array([0x11, 0x22]),
          repoRev: 'rev-3'
        },
        { cid: 'bafy-03', bytes: new Uint8Array([0x33]), repoRev: 'rev-3' }
      ]
    })

    // Duplicate insert with an older repoRev must not regress repoRev.
    await database.putPdsBlocks({
      did,
      blocks: [
        {
          cid: 'bafy-02',
          bytes: new Uint8Array([0x44, 0x55]),
          repoRev: 'rev-1'
        }
      ]
    })

    const fetched = await database.getPdsBlocks({
      did,
      cids: ['bafy-01', 'bafy-02', 'bafy-missing']
    })
    expect(fetched).toHaveLength(2)
    const byCid = new Map(fetched.map((b) => [b.cid, b]))
    const b1 = byCid.get('bafy-01')
    const b2 = byCid.get('bafy-02')
    expect(Buffer.isBuffer(b1?.bytes)).toBe(true)
    expect(b1?.bytes.equals(Buffer.from(fullByteRange))).toBe(true)
    expect(Buffer.isBuffer(b2?.bytes)).toBe(true)
    expect(
      b2?.bytes.equals(Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]))
    ).toBe(true)
    expect(b2?.repoRev).toBe('rev-3')

    const sinceRev2 = await database.getPdsBlocksByRev({
      did,
      sinceRev: 'rev-2'
    })
    expect(sinceRev2.map((b) => b.cid)).toEqual(['bafy-02', 'bafy-03'])

    const exactRev3 = await database.getPdsBlocksByRev({
      did,
      repoRev: 'rev-3'
    })
    expect(exactRev3.map((b) => b.cid)).toEqual(['bafy-02', 'bafy-03'])

    const list1 = await database.listPdsBlocks({ did, limit: 2 })
    expect(list1.blocks.map((b) => b.cid)).toEqual(['bafy-01', 'bafy-02'])
    expect(list1.cursor).toBe('bafy-02')
    const list2 = await database.listPdsBlocks({
      did,
      cursor: list1.cursor,
      limit: 2
    })
    expect(list2.blocks.map((b) => b.cid)).toEqual(['bafy-03'])
    expect(list2.cursor).toBeUndefined()

    const ev = await database.appendPdsEvent({
      did,
      type: 'commit',
      payload: sliceView
    })
    expect(Buffer.isBuffer(ev.payload)).toBe(true)
    expect(
      ev.payload.equals(Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]))
    ).toBe(true)
  })

  it('deduplicates duplicate CIDs within a single putPdsBlocks batch keeping the newest repoRev', async () => {
    const did = 'did:web:dedup-blocks.pds.example'

    // Pre-existing block at rev-3 so we also exercise ON CONFLICT against a
    // deduplicated batch row.
    await database.putPdsBlocks({
      did,
      blocks: [
        {
          cid: 'bafy-existing',
          bytes: Buffer.from([0x01, 0x02, 0x03]),
          repoRev: 'rev-3'
        }
      ]
    })

    // Batch contains duplicate CIDs in ascending, descending, and conflict orders.
    await database.putPdsBlocks({
      did,
      blocks: [
        {
          cid: 'bafy-dup-asc',
          bytes: Buffer.from([0xaa, 0xbb]),
          repoRev: 'rev-1'
        },
        {
          cid: 'bafy-dup-asc',
          bytes: Buffer.from([0xaa, 0xbb]),
          repoRev: 'rev-4'
        },
        {
          cid: 'bafy-dup-desc',
          bytes: Buffer.from([0xcc, 0xdd]),
          repoRev: 'rev-5'
        },
        {
          cid: 'bafy-dup-desc',
          bytes: Buffer.from([0xcc, 0xdd]),
          repoRev: 'rev-2'
        },
        {
          cid: 'bafy-existing',
          bytes: Buffer.from([0x99]),
          repoRev: 'rev-2'
        },
        {
          cid: 'bafy-existing',
          bytes: Buffer.from([0x88]),
          repoRev: 'rev-6'
        }
      ]
    })

    // Duplicate older revisions against an existing row must not regress repoRev.
    await database.putPdsBlocks({
      did,
      blocks: [
        {
          cid: 'bafy-existing',
          bytes: Buffer.from([0x77]),
          repoRev: 'rev-1'
        },
        {
          cid: 'bafy-existing',
          bytes: Buffer.from([0x66]),
          repoRev: 'rev-2'
        }
      ]
    })

    const fetched = await database.getPdsBlocks({
      did,
      cids: ['bafy-dup-asc', 'bafy-dup-desc', 'bafy-existing']
    })
    expect(fetched).toHaveLength(3)
    const byCid = new Map(fetched.map((b) => [b.cid, b]))
    expect(byCid.get('bafy-dup-asc')?.repoRev).toBe('rev-4')
    expect(
      byCid.get('bafy-dup-asc')?.bytes.equals(Buffer.from([0xaa, 0xbb]))
    ).toBe(true)
    expect(byCid.get('bafy-dup-desc')?.repoRev).toBe('rev-5')
    expect(
      byCid.get('bafy-dup-desc')?.bytes.equals(Buffer.from([0xcc, 0xdd]))
    ).toBe(true)
    expect(byCid.get('bafy-existing')?.repoRev).toBe('rev-6')
    expect(
      byCid.get('bafy-existing')?.bytes.equals(Buffer.from([0x01, 0x02, 0x03]))
    ).toBe(true)
  })

  it('upserts, lists with forward/reverse cursors, and deletes records', async () => {
    const did = 'did:web:rec.pds.example'
    const collection = 'app.bsky.feed.post'

    await database.upsertPdsRecord({
      did,
      collection,
      rkey: '3k00001',
      cid: 'bafy-r1',
      repoRev: 'rev-1'
    })
    await database.upsertPdsRecord({
      did,
      collection,
      rkey: '3k00002',
      cid: 'bafy-r2',
      repoRev: 'rev-2'
    })
    await database.upsertPdsRecord({
      did,
      collection,
      rkey: '3k00003',
      cid: 'bafy-r3',
      repoRev: 'rev-3'
    })
    await database.upsertPdsRecord({
      did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
      cid: 'bafy-prof',
      repoRev: 'rev-1'
    })

    // Upsert updates existing record CID/rev.
    await database.upsertPdsRecord({
      did,
      collection,
      rkey: '3k00002',
      cid: 'bafy-r2-updated',
      repoRev: 'rev-4'
    })
    expect(
      await database.getPdsRecord({ did, collection, rkey: '3k00002' })
    ).toMatchObject({ cid: 'bafy-r2-updated', repoRev: 'rev-4' })

    expect(await database.listPdsCollections({ did })).toEqual([
      'app.bsky.actor.profile',
      'app.bsky.feed.post'
    ])

    // Default order (reverse: false) is descending by rkey.
    const desc1 = await database.listPdsRecords({ did, collection, limit: 2 })
    expect(desc1.records.map((r) => r.rkey)).toEqual(['3k00003', '3k00002'])
    expect(desc1.cursor).toBe('3k00002')
    const desc2 = await database.listPdsRecords({
      did,
      collection,
      cursor: desc1.cursor,
      limit: 2
    })
    expect(desc2.records.map((r) => r.rkey)).toEqual(['3k00001'])
    expect(desc2.cursor).toBeUndefined()

    // Reversed order (reverse: true) is ascending by rkey.
    const asc1 = await database.listPdsRecords({
      did,
      collection,
      limit: 2,
      reverse: true
    })
    expect(asc1.records.map((r) => r.rkey)).toEqual(['3k00001', '3k00002'])
    expect(asc1.cursor).toBe('3k00002')
    const asc2 = await database.listPdsRecords({
      did,
      collection,
      cursor: asc1.cursor,
      limit: 2,
      reverse: true
    })
    expect(asc2.records.map((r) => r.rkey)).toEqual(['3k00003'])
    expect(asc2.cursor).toBeUndefined()

    expect(
      await database.deletePdsRecord({ did, collection, rkey: '3k00002' })
    ).toBe(true)
    expect(
      await database.deletePdsRecord({ did, collection, rkey: '3k00002' })
    ).toBe(false)
    expect(
      await database.getPdsRecord({ did, collection, rkey: '3k00002' })
    ).toBeNull()
  })

  it('orders pds_records.rkey and collection in strict byte order and allows recordUri up to 2048 chars', async () => {
    const did = 'did:web:collation.pds.example'
    const collection = 'app.bsky.feed.post'

    // ASCII byte order: 'A'(65) < 'B'(66) < '_'(95) < 'a'(97) < 'b'(98) < '~'(126).
    // Locale collations (e.g. en_US.UTF-8) interleave 'a'/'A' and 'b'/'B'.
    const rkeys = ['~', 'b', 'a', '_', 'B', 'A']
    for (const rkey of rkeys) {
      await database.upsertPdsRecord({
        did,
        collection,
        rkey,
        cid: `bafy-${rkey}`,
        repoRev: 'rev-1'
      })
    }

    const asc = await database.listPdsRecords({
      did,
      collection,
      reverse: true,
      limit: 20
    })
    expect(asc.records.map((r) => r.rkey)).toEqual([
      'A',
      'B',
      '_',
      'a',
      'b',
      '~'
    ])

    const desc = await database.listPdsRecords({
      did,
      collection,
      reverse: false,
      limit: 20
    })
    expect(desc.records.map((r) => r.rkey)).toEqual([
      '~',
      'b',
      'a',
      '_',
      'B',
      'A'
    ])

    // Same byte-order check for collection ordering.
    const collDid = 'did:web:coll-order.pds.example'
    for (const coll of ['com.b.rec', 'com.a.rec', 'com.B.rec', 'com.A.rec']) {
      await database.upsertPdsRecord({
        did: collDid,
        collection: coll,
        rkey: 'self',
        cid: `bafy-${coll}`,
        repoRev: 'rev-1'
      })
    }
    expect(await database.listPdsCollections({ did: collDid })).toEqual([
      'com.A.rec',
      'com.B.rec',
      'com.a.rec',
      'com.b.rec'
    ])

    // recordUri > 1024 chars (up to 2048) must fit in pds_record_blobs.
    const longRecordUri = `at://${did}/app.bsky.feed.post/${'k'.repeat(1500)}`
    await database.putPdsRecordBlobs({
      did,
      recordUri: longRecordUri,
      blobCids: ['bafy-long-uri-blob']
    })
    expect(
      await database.getPdsRecordBlobs({ did, recordUri: longRecordUri })
    ).toEqual(['bafy-long-uri-blob'])
  })

  it('orders events by monotonically increasing seq and prunes old events', async () => {
    const did = 'did:web:evt.pds.example'
    const t0 = Date.UTC(2026, 10, 1, 0, 0, 0)
    const t1 = Date.UTC(2026, 10, 5, 0, 0, 0)
    const t2 = Date.UTC(2026, 10, 10, 0, 0, 0)

    const e1 = await database.appendPdsEvent({
      did,
      type: 'commit',
      payload: Buffer.from('one'),
      createdAt: t0
    })
    const e2 = await database.appendPdsEvent({
      did,
      type: 'identity',
      payload: Buffer.from('two'),
      createdAt: t1
    })
    const e3 = await database.appendPdsEvent({
      did,
      type: 'account',
      payload: Buffer.from('three'),
      createdAt: t2
    })

    expect(e1.seq).toBeLessThan(e2.seq)
    expect(e2.seq).toBeLessThan(e3.seq)

    const after1 = await database.listPdsEvents({
      afterSeq: e1.seq,
      limit: 10,
      did
    })
    expect(after1.map((e) => e.seq)).toEqual([e2.seq, e3.seq])
    expect(after1.map((e) => e.type)).toEqual(['identity', 'account'])

    const pruned = await database.deletePdsEventsBefore({
      before: Date.UTC(2026, 10, 6, 0, 0, 0)
    })
    expect(pruned).toBeGreaterThanOrEqual(2)

    const remaining = await database.listPdsEvents({ afterSeq: 0, did })
    expect(remaining.map((e) => e.seq)).toEqual([e3.seq])
  })

  it('writes commits atomically, garbage-collects unreferenced blobs, and rolls back on conflict or error', async () => {
    const did = 'did:web:commit.pds.example'
    await database.createPdsRepo({
      did,
      actorId: 'https://commit.example/users/alice',
      domain: 'commit.example',
      signingKey: 'v1:key',
      signingKeyDid: 'did:key:zQ3shCommit'
    })
    await database.createPdsBlob({
      did,
      cid: 'bafy-blob-1',
      mimeType: 'image/jpeg',
      size: 1234,
      storageKey: 'pds-blobs/did/bafy-blob-1'
    })
    await database.createPdsBlob({
      did,
      cid: 'bafy-blob-2',
      mimeType: 'image/png',
      size: 5678,
      storageKey: 'pds-blobs/did/bafy-blob-2'
    })
    await database.createPdsBlob({
      did,
      cid: 'bafy-blob-3',
      mimeType: 'image/webp',
      size: 9012,
      storageKey: 'pds-blobs/did/bafy-blob-3'
    })

    // Unreferenced blobs are not returned by getPdsBlob or listPdsBlobs,
    // but are visible to includeUnreferenced and listPdsBlobStorageKeys.
    expect(await database.getPdsBlob({ did, cid: 'bafy-blob-1' })).toBeNull()
    expect(
      await database.getPdsBlob({
        did,
        cid: 'bafy-blob-1',
        includeUnreferenced: true
      })
    ).not.toBeNull()
    expect(await database.listPdsBlobs({ did })).toEqual({
      blobs: [],
      cursor: undefined
    })
    expect((await database.listPdsBlobStorageKeys({ did })).sort()).toEqual([
      'pds-blobs/did/bafy-blob-1',
      'pds-blobs/did/bafy-blob-2',
      'pds-blobs/did/bafy-blob-3'
    ])

    // deletePdsBlob supports an optional storageKey guard so callers only
    // delete a row they own.
    await database.createPdsBlob({
      did,
      cid: 'bafy-blob-temp',
      mimeType: 'image/png',
      size: 42,
      storageKey: 'pds-blobs/did/bafy-blob-temp.1111111111111111'
    })
    expect(
      await database.deletePdsBlob({
        did,
        cid: 'bafy-blob-temp',
        storageKey: 'pds-blobs/did/bafy-blob-temp.2222222222222222'
      })
    ).toBe(false)
    expect(
      await database.getPdsBlob({
        did,
        cid: 'bafy-blob-temp',
        includeUnreferenced: true
      })
    ).not.toBeNull()
    expect(
      await database.deletePdsBlob({
        did,
        cid: 'bafy-blob-temp',
        storageKey: 'pds-blobs/did/bafy-blob-temp.1111111111111111'
      })
    ).toBe(true)
    expect(
      await database.getPdsBlob({
        did,
        cid: 'bafy-blob-temp',
        includeUnreferenced: true
      })
    ).toBeNull()

    // First atomic commit (expectedRev: null).
    const c1 = await database.commitPdsRepoWrite({
      did,
      rootCid: 'bafy-commit-1',
      rev: '3k00000000100',
      expectedRev: null,
      blocks: [
        { cid: 'bafy-commit-1', bytes: Buffer.from([1, 2, 3]) },
        { cid: 'bafy-rec-1', bytes: Buffer.from([4, 5, 6]) }
      ],
      recordWrites: [
        {
          action: 'create',
          collection: 'app.bsky.feed.post',
          rkey: '3k100',
          cid: 'bafy-rec-1',
          blobCids: ['bafy-blob-1']
        }
      ],
      event: {
        type: 'commit',
        payload: Buffer.from('cbor-commit-1')
      }
    })
    expect(c1.committed).toBe(true)
    expect(c1.event?.seq).toBeGreaterThan(0)

    const recordUri = `at://${did}/app.bsky.feed.post/3k100`
    expect(await database.getPdsRecordBlobs({ did, recordUri })).toEqual([
      'bafy-blob-1'
    ])
    expect(
      await database.countPdsBlobReferences({ did, blobCid: 'bafy-blob-1' })
    ).toBe(1)

    // Optimistic conflict: wrong expectedRev writes nothing at all.
    const conflict = await database.commitPdsRepoWrite({
      did,
      rootCid: 'bafy-commit-conflict',
      rev: '3k00000000200',
      expectedRev: 'wrong-rev',
      blocks: [{ cid: 'bafy-conflict-block', bytes: Buffer.from([9]) }],
      recordWrites: [
        {
          action: 'create',
          collection: 'app.bsky.feed.post',
          rkey: '3k200',
          cid: 'bafy-conflict-block'
        }
      ],
      event: {
        type: 'commit',
        payload: Buffer.from('should-not-exist')
      }
    })
    expect(conflict).toEqual({
      committed: false,
      event: null,
      deletedBlobStorageKeys: []
    })
    expect(
      await database.getPdsBlocks({ did, cids: ['bafy-conflict-block'] })
    ).toEqual([])
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3k200'
      })
    ).toBeNull()

    // Mid-transaction failure rolls back head, blocks, records, and record_blobs.
    const unsubscribe = testDb.onQuery(({ sql }) => {
      if (sql.toLowerCase().includes('insert into "pds_events"')) {
        throw new Error('simulated event insert failure')
      }
    })
    try {
      await expect(
        database.commitPdsRepoWrite({
          did,
          rootCid: 'bafy-commit-rollback',
          rev: '3k00000000150',
          expectedRev: '3k00000000100',
          blocks: [{ cid: 'bafy-rollback-block', bytes: Buffer.from([7]) }],
          recordWrites: [
            {
              action: 'create',
              collection: 'app.bsky.feed.post',
              rkey: '3k150',
              cid: 'bafy-rollback-block',
              blobCids: ['bafy-blob-2']
            }
          ],
          event: {
            type: 'commit',
            payload: Buffer.from('boom')
          }
        })
      ).rejects.toThrow('simulated event insert failure')
    } finally {
      unsubscribe()
    }

    expect(await database.getPdsRepo({ did })).toMatchObject({
      rootCid: 'bafy-commit-1',
      rev: '3k00000000100'
    })
    expect(
      await database.getPdsBlocks({ did, cids: ['bafy-rollback-block'] })
    ).toEqual([])
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3k150'
      })
    ).toBeNull()
    expect(
      await database.countPdsBlobReferences({ did, blobCid: 'bafy-blob-2' })
    ).toBe(0)

    // Second commit updates blob links (dropping bafy-blob-1, adding bafy-blob-2 and bafy-blob-3).
    const c2 = await database.commitPdsRepoWrite({
      did,
      rootCid: 'bafy-commit-2',
      rev: '3k00000000200',
      expectedRev: '3k00000000100',
      blocks: [{ cid: 'bafy-commit-2', bytes: Buffer.from([8, 9]) }],
      recordWrites: [
        {
          action: 'update',
          collection: 'app.bsky.feed.post',
          rkey: '3k100',
          cid: 'bafy-rec-1-v2',
          blobCids: ['bafy-blob-2', 'bafy-blob-3']
        }
      ],
      event: {
        type: 'commit',
        payload: Buffer.from('cbor-commit-2')
      }
    })
    expect(c2.committed).toBe(true)
    // bafy-blob-1 lost its last reference, so its pds_blobs row was deleted and storageKey returned.
    expect(c2.deletedBlobStorageKeys).toEqual(['pds-blobs/did/bafy-blob-1'])
    expect(
      await database.getPdsBlob({
        did,
        cid: 'bafy-blob-1',
        includeUnreferenced: true
      })
    ).toBeNull()
    expect(await database.getPdsRecordBlobs({ did, recordUri })).toEqual([
      'bafy-blob-2',
      'bafy-blob-3'
    ])
    expect(
      await database.countPdsBlobReferences({ did, blobCid: 'bafy-blob-1' })
    ).toBe(0)
    expect(
      await database.countPdsBlobReferences({ did, blobCid: 'bafy-blob-2' })
    ).toBe(1)
    expect(
      await database.getPdsBlob({ did, cid: 'bafy-blob-2' })
    ).not.toBeNull()

    const blobsSince1 = await database.listPdsBlobs({
      did,
      since: '3k00000000100'
    })
    expect(blobsSince1.blobs.map((b) => b.cid)).toEqual([
      'bafy-blob-2',
      'bafy-blob-3'
    ])

    const allBlobsPage1 = await database.listPdsBlobs({ did, limit: 1 })
    expect(allBlobsPage1.blobs.map((b) => b.cid)).toEqual(['bafy-blob-2'])
    expect(allBlobsPage1.cursor).toBe('bafy-blob-2')
    const allBlobsPage2 = await database.listPdsBlobs({
      did,
      cursor: allBlobsPage1.cursor,
      limit: 1
    })
    expect(allBlobsPage2.blobs.map((b) => b.cid)).toEqual(['bafy-blob-3'])
    expect(allBlobsPage2.cursor).toBeUndefined()

    // Third commit deletes the record, removes record_blobs links, and deletes the now-unreferenced blobs.
    const c3 = await database.commitPdsRepoWrite({
      did,
      rootCid: 'bafy-commit-3',
      rev: '3k00000000300',
      expectedRev: '3k00000000200',
      blocks: [{ cid: 'bafy-commit-3', bytes: Buffer.from([10]) }],
      recordWrites: [
        {
          action: 'delete',
          collection: 'app.bsky.feed.post',
          rkey: '3k100'
        }
      ]
    })
    expect(c3.committed).toBe(true)
    expect(c3.deletedBlobStorageKeys.sort()).toEqual([
      'pds-blobs/did/bafy-blob-2',
      'pds-blobs/did/bafy-blob-3'
    ])
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3k100'
      })
    ).toBeNull()
    expect(await database.getPdsRecordBlobs({ did, recordUri })).toEqual([])
    expect(await database.listPdsBlobStorageKeys({ did })).toEqual([])
  })

  it('deletes all PDS rows for an actor during deleteActorData without touching other actors', async () => {
    const doomedActorId = await createLocalActor('pds-doomed')
    const survivorActorId = await createLocalActor('pds-survivor')
    const doomedDid = 'did:web:doomed.pds.example'
    const survivorDid = 'did:web:survivor.pds.example'

    for (const [actorId, did] of [
      [doomedActorId, doomedDid],
      [survivorActorId, survivorDid]
    ] as const) {
      await database.createPdsRepo({
        did,
        actorId,
        domain: TEST_DOMAIN,
        signingKey: `v1:key-${did}`,
        signingKeyDid: `did:key:zQ3sh-${did}`
      })
      await database.createPdsBlob({
        did,
        cid: `bafy-blob-${did}`,
        mimeType: 'image/webp',
        size: 42,
        storageKey: `pds-blobs/${did}/bafy`
      })
      await database.commitPdsRepoWrite({
        did,
        rootCid: `bafy-root-${did}`,
        rev: '3k00000000001',
        expectedRev: null,
        blocks: [{ cid: `bafy-blk-${did}`, bytes: Buffer.from([1, 2]) }],
        recordWrites: [
          {
            action: 'create',
            collection: 'app.bsky.feed.post',
            rkey: '3k1',
            cid: `bafy-blk-${did}`,
            blobCids: [`bafy-blob-${did}`]
          }
        ],
        event: {
          type: 'commit',
          payload: Buffer.from(`evt-${did}`)
        }
      })
    }

    await database.deleteActorData({ actorId: doomedActorId })

    // The repo row stays as a tombstone that retention removes later; its
    // records, blocks and blobs are gone.
    const doomedRepo = await database.getPdsRepo({ did: doomedDid })
    expect(doomedRepo?.status).toBe('deleted')
    // It gives up the actor's slot, so it is found only by DID.
    expect(await database.getPdsRepo({ actorId: doomedActorId })).toBeNull()
    expect(
      await database.getPdsBlocks({
        did: doomedDid,
        cids: [`bafy-blk-${doomedDid}`]
      })
    ).toEqual([])
    expect(
      await database.getPdsRecord({
        did: doomedDid,
        collection: 'app.bsky.feed.post',
        rkey: '3k1'
      })
    ).toBeNull()
    // The commit event and the account-deleted event stay for the firehose.
    const doomedEvents = await database.listPdsEvents({
      afterSeq: 0,
      did: doomedDid
    })
    expect(doomedEvents.map((event) => event.type)).toEqual([
      'commit',
      'account'
    ])
    expect(
      await database.getPdsBlob({
        did: doomedDid,
        cid: `bafy-blob-${doomedDid}`
      })
    ).toBeNull()
    expect(
      await database.getPdsRecordBlobs({
        did: doomedDid,
        recordUri: `at://${doomedDid}/app.bsky.feed.post/3k1`
      })
    ).toEqual([])

    // Survivor actor's PDS rows remain completely intact.
    expect(await database.getPdsRepo({ did: survivorDid })).not.toBeNull()
    expect(
      await database.getPdsBlocks({
        did: survivorDid,
        cids: [`bafy-blk-${survivorDid}`]
      })
    ).toHaveLength(1)
    expect(
      await database.getPdsRecord({
        did: survivorDid,
        collection: 'app.bsky.feed.post',
        rkey: '3k1'
      })
    ).not.toBeNull()
    expect(
      await database.listPdsEvents({ afterSeq: 0, did: survivorDid })
    ).toHaveLength(1)
    expect(
      await database.getPdsBlob({
        did: survivorDid,
        cid: `bafy-blob-${survivorDid}`
      })
    ).not.toBeNull()
    expect(
      await database.getPdsRecordBlobs({
        did: survivorDid,
        recordUri: `at://${survivorDid}/app.bsky.feed.post/3k1`
      })
    ).toEqual([`bafy-blob-${survivorDid}`])
  })

  it('bounds listPdsCollections to at most MAX_PDS_COLLECTIONS_LIMIT (1000) collections', async () => {
    const did = 'did:web:many-collections.pds.example'
    await database.createPdsRepo({
      did,
      actorId: 'https://many-coll.example/users/alice',
      domain: 'many-coll.example',
      signingKey: 'v1:key',
      signingKeyDid: 'did:key:zQ3shManyColl'
    })

    const total = MAX_PDS_COLLECTIONS_LIMIT + 5
    const recordWrites = Array.from({ length: total }, (_, i) => ({
      action: 'create' as const,
      collection: `com.example.col${String(i).padStart(4, '0')}`,
      rkey: 'self',
      cid: `bafy-col-${i}`
    }))

    const committed = await database.commitPdsRepoWrite({
      did,
      rootCid: 'bafy-root-many-col',
      rev: '3k00000000001',
      expectedRev: null,
      blocks: [],
      recordWrites
    })
    expect(committed.committed).toBe(true)

    const collections = await database.listPdsCollections({ did })
    expect(collections).toHaveLength(MAX_PDS_COLLECTIONS_LIMIT)
    expect(collections[0]).toBe('com.example.col0000')
    expect(collections[collections.length - 1]).toBe(
      `com.example.col${String(MAX_PDS_COLLECTIONS_LIMIT - 1).padStart(4, '0')}`
    )

    // Explicit limit above the cap is still clamped to MAX_PDS_COLLECTIONS_LIMIT.
    expect(
      await database.listPdsCollections({
        did,
        limit: MAX_PDS_COLLECTIONS_LIMIT + 500
      })
    ).toHaveLength(MAX_PDS_COLLECTIONS_LIMIT)
  })

  it('filters listPdsEvents by domain, enforces page count and maxBytes limits, and computes global seq bounds', async () => {
    const domainA = 'firehose-a.example'
    const domainB = 'firehose-b.example'

    await testDb.db.deleteFrom('pds_events').execute()

    expect(await database.getPdsEventSeqBounds()).toEqual({
      oldest: null,
      newest: null
    })

    const didA1 = 'did:web:a1.firehose.example'
    const didA2 = 'did:web:a2.firehose.example'
    const didB1 = 'did:web:b1.firehose.example'

    await database.createPdsRepo({
      did: didA1,
      actorId: 'https://firehose-a.example/users/a1',
      domain: domainA,
      signingKey: 'v1:key-a1',
      signingKeyDid: 'did:key:zQ3shA1'
    })
    await database.createPdsRepo({
      did: didA2,
      actorId: 'https://firehose-a.example/users/a2',
      domain: domainA,
      signingKey: 'v1:key-a2',
      signingKeyDid: 'did:key:zQ3shA2'
    })
    await database.createPdsRepo({
      did: didB1,
      actorId: 'https://firehose-b.example/users/b1',
      domain: domainB,
      signingKey: 'v1:key-b1',
      signingKeyDid: 'did:key:zQ3shB1'
    })

    const oldTime = Date.UTC(2020, 0, 1, 0, 0, 0)
    const recentTime = Date.UTC(2026, 10, 20, 0, 0, 0)

    const a1 = await database.appendPdsEvent({
      did: didA1,
      type: 'identity',
      payload: Buffer.from('a1'),
      createdAt: oldTime
    })
    const b1 = await database.appendPdsEvent({
      did: didB1,
      type: 'commit',
      payload: Buffer.from('b1'),
      createdAt: recentTime
    })
    const a2 = await database.appendPdsEvent({
      did: didA2,
      type: 'commit',
      payload: Buffer.from('a2'),
      createdAt: recentTime
    })
    const b2 = await database.appendPdsEvent({
      did: didB1,
      type: 'account',
      payload: Buffer.from('b2'),
      createdAt: recentTime
    })
    const a3 = await database.appendPdsEvent({
      did: didA1,
      type: 'account',
      payload: Buffer.from('a3'),
      createdAt: recentTime
    })

    expect(await database.getPdsEventSeqBounds()).toEqual({
      oldest: a1.seq,
      newest: a3.seq
    })

    const domainAEvents = await database.listPdsEvents({
      afterSeq: 0,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      domain: domainA
    })
    expect(domainAEvents.map((e) => e.seq)).toEqual([a1.seq, a2.seq, a3.seq])
    expect(domainAEvents.map((e) => e.did)).toEqual([didA1, didA2, didA1])

    const domainBEvents = await database.listPdsEvents({
      afterSeq: 0,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      domain: domainB
    })
    expect(domainBEvents.map((e) => e.seq)).toEqual([b1.seq, b2.seq])

    const domainAAfterFirst = await database.listPdsEvents({
      afterSeq: a1.seq,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      domain: domainA
    })
    expect(domainAAfterFirst.map((e) => e.seq)).toEqual([a2.seq, a3.seq])

    // Pin the real page limit: append more rows than PDS_FIREHOSE_PAGE_SIZE (100)
    // and confirm page 1 is capped at exactly PDS_FIREHOSE_PAGE_SIZE rows.
    const pageDomain = 'firehose-page.example'
    const pageDid = 'did:web:page.firehose.example'
    await database.createPdsRepo({
      did: pageDid,
      actorId: 'https://firehose-page.example/users/page',
      domain: pageDomain,
      signingKey: 'v1:key-page',
      signingKeyDid: 'did:key:zQ3shPage'
    })
    const totalPageEvents = PDS_FIREHOSE_PAGE_SIZE + 25
    for (let i = 0; i < totalPageEvents; i += 1) {
      await database.appendPdsEvent({
        did: pageDid,
        type: 'commit',
        payload: Buffer.from(`p-${i}`),
        createdAt: recentTime
      })
    }
    const page1 = await database.listPdsEvents({
      afterSeq: 0,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      maxBytes: PDS_FIREHOSE_PAGE_MAX_BYTES,
      domain: pageDomain
    })
    expect(page1).toHaveLength(PDS_FIREHOSE_PAGE_SIZE)

    const page2 = await database.listPdsEvents({
      afterSeq: page1[page1.length - 1].seq,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      maxBytes: PDS_FIREHOSE_PAGE_MAX_BYTES,
      domain: pageDomain
    })
    expect(page2).toHaveLength(25)

    // Verify maxBytes caps a page using SQL byte length and always returns at least one row.
    const byteDomain = 'firehose-bytes.example'
    const byteDid = 'did:web:bytes.firehose.example'
    await database.createPdsRepo({
      did: byteDid,
      actorId: 'https://firehose-bytes.example/users/bytes',
      domain: byteDomain,
      signingKey: 'v1:key-bytes',
      signingKeyDid: 'did:key:zQ3shBytes'
    })
    const big1 = await database.appendPdsEvent({
      did: byteDid,
      type: 'commit',
      payload: Buffer.alloc(600, 1),
      createdAt: recentTime
    })
    const big2 = await database.appendPdsEvent({
      did: byteDid,
      type: 'commit',
      payload: Buffer.alloc(600, 2),
      createdAt: recentTime
    })
    const oversized = await database.appendPdsEvent({
      did: byteDid,
      type: 'commit',
      payload: Buffer.alloc(2_000, 3),
      createdAt: recentTime
    })
    const tail = await database.appendPdsEvent({
      did: byteDid,
      type: 'commit',
      payload: Buffer.alloc(100, 4),
      createdAt: recentTime
    })

    let bytePage1: Awaited<ReturnType<typeof database.listPdsEvents>> = []
    const byteQueries = await testDb.captureQueries(async () => {
      bytePage1 = await database.listPdsEvents({
        afterSeq: 0,
        limit: PDS_FIREHOSE_PAGE_SIZE,
        maxBytes: 1_300,
        domain: byteDomain
      })
    })
    expect(bytePage1.map((e) => e.seq)).toEqual([big1.seq, big2.seq])
    const expectedLenFn = testDb.backend === 'pg' ? 'octet_length(' : 'length('
    expect(
      byteQueries.some((q) => q.sql.toLowerCase().includes(expectedLenFn))
    ).toBe(true)

    // Oversized single row (> maxBytes) is still returned alone so progress never stalls.
    const bytePage2 = await database.listPdsEvents({
      afterSeq: big2.seq,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      maxBytes: 1_300,
      domain: byteDomain
    })
    expect(bytePage2.map((e) => e.seq)).toEqual([oversized.seq])

    const bytePage3 = await database.listPdsEvents({
      afterSeq: oversized.seq,
      limit: PDS_FIREHOSE_PAGE_SIZE,
      maxBytes: 1_300,
      domain: byteDomain
    })
    expect(bytePage3.map((e) => e.seq)).toEqual([tail.seq])

    expect(await database.getPdsEventSeqBounds()).toEqual({
      oldest: a1.seq,
      newest: tail.seq
    })

    // Pruning the oldest event (a1) advances the global oldest bound to b1.
    await database.deletePdsEventsBefore({
      before: Date.UTC(2021, 0, 1, 0, 0, 0)
    })
    expect(await database.getPdsEventSeqBounds()).toEqual({
      oldest: b1.seq,
      newest: tail.seq
    })
  })

  it('filters listPdsEvents to effectively active repos when activeReposOnly is true while always keeping account events', async () => {
    const visDomain = 'vis-filter.example'
    await testDb.db.deleteFrom('pds_events').execute()

    const seedActorRepo = async (
      username: string,
      did: string,
      repoStatus: 'active' | 'deactivated' | 'takendown' = 'active'
    ) => {
      const accountId = await database.createAccount({
        email: `${username}@${visDomain}`,
        username,
        passwordHash: TEST_PASSWORD_HASH,
        domain: visDomain,
        privateKey: `priv-${username}`,
        publicKey: `pub-${username}`
      })
      const actorId = `https://${visDomain}/users/${username}`
      await database.createPdsRepo({
        did,
        actorId,
        domain: visDomain,
        signingKey: `v1:key-${username}`,
        signingKeyDid: `did:key:zQ3sh${username}`,
        status: repoStatus
      })
      return { accountId, actorId, did }
    }

    const active = await seedActorRepo(
      'visactive',
      'did:web:active.vis.example'
    )
    const grandfathered = await seedActorRepo(
      'visgrand',
      'did:web:grandfathered.vis.example'
    )
    await testDb.db
      .updateTable('accounts')
      .set({ verificationCode: 'legacy-code', emailVerified: true })
      .where('id', '=', grandfathered.accountId)
      .execute()

    const suspended = await seedActorRepo(
      'vissusp',
      'did:web:suspended.vis.example'
    )
    await testDb.db
      .updateTable('actors')
      .set({ suspendedAt: new Date() })
      .where('id', '=', suspended.actorId)
      .execute()

    const takendown = await seedActorRepo(
      'vistaken',
      'did:web:takendown.vis.example',
      'takendown'
    )

    const deactivated = await seedActorRepo(
      'visdeact',
      'did:web:deactivated.vis.example',
      'deactivated'
    )

    const disabled = await seedActorRepo(
      'visdisab',
      'did:web:disabled.vis.example'
    )
    await testDb.db
      .updateTable('accounts')
      .set({ disabledAt: new Date() })
      .where('id', '=', disabled.accountId)
      .execute()

    const unapproved = await seedActorRepo(
      'visunapp',
      'did:web:unapproved.vis.example'
    )
    await testDb.db
      .updateTable('accounts')
      .set({ approvedAt: null })
      .where('id', '=', unapproved.accountId)
      .execute()

    const unconfirmed = await seedActorRepo(
      'visunconf',
      'did:web:unconfirmed.vis.example'
    )
    await testDb.db
      .updateTable('accounts')
      .set({ verificationCode: 'pending-code', emailVerified: false })
      .where('id', '=', unconfirmed.accountId)
      .execute()

    const deleting = await seedActorRepo(
      'visdel',
      'did:web:deleting.vis.example'
    )
    await testDb.db
      .updateTable('actors')
      .set({ deletionStatus: 'scheduled', deletionScheduledAt: new Date() })
      .where('id', '=', deleting.actorId)
      .execute()

    const append = (
      did: string,
      type: 'commit' | 'identity' | 'sync' | 'account'
    ) =>
      database.appendPdsEvent({
        did,
        type,
        payload: Buffer.from(`${did}:${type}`)
      })

    const activeCommit = await append(active.did, 'commit')
    const activeIdentity = await append(active.did, 'identity')
    const activeSync = await append(active.did, 'sync')
    const activeAccount = await append(active.did, 'account')
    const grandfatheredCommit = await append(grandfathered.did, 'commit')

    const suspendedCommit = await append(suspended.did, 'commit')
    const suspendedIdentity = await append(suspended.did, 'identity')
    const suspendedSync = await append(suspended.did, 'sync')
    const suspendedAccount = await append(suspended.did, 'account')

    const takendownCommit = await append(takendown.did, 'commit')
    const takendownAccount = await append(takendown.did, 'account')

    const deactivatedCommit = await append(deactivated.did, 'commit')
    const deactivatedAccount = await append(deactivated.did, 'account')

    const disabledCommit = await append(disabled.did, 'commit')
    const disabledAccount = await append(disabled.did, 'account')

    const unapprovedCommit = await append(unapproved.did, 'commit')
    const unapprovedAccount = await append(unapproved.did, 'account')

    const unconfirmedCommit = await append(unconfirmed.did, 'commit')
    const unconfirmedAccount = await append(unconfirmed.did, 'account')

    const deletingCommit = await append(deleting.did, 'commit')
    const deletingAccount = await append(deleting.did, 'account')

    const allExpected = [
      activeCommit,
      activeIdentity,
      activeSync,
      activeAccount,
      grandfatheredCommit,
      suspendedCommit,
      suspendedIdentity,
      suspendedSync,
      suspendedAccount,
      takendownCommit,
      takendownAccount,
      deactivatedCommit,
      deactivatedAccount,
      disabledCommit,
      disabledAccount,
      unapprovedCommit,
      unapprovedAccount,
      unconfirmedCommit,
      unconfirmedAccount,
      deletingCommit,
      deletingAccount
    ].map((e) => e.seq)

    const filteredExpected = [
      activeCommit,
      activeIdentity,
      activeSync,
      activeAccount,
      grandfatheredCommit,
      suspendedAccount,
      takendownAccount,
      deactivatedAccount,
      disabledAccount,
      unapprovedAccount,
      unconfirmedAccount,
      deletingAccount
    ].map((e) => e.seq)

    // Without activeReposOnly: every event is returned.
    const unfiltered = await database.listPdsEvents({
      afterSeq: 0,
      domain: visDomain
    })
    expect(unfiltered.map((e) => e.seq)).toEqual(allExpected)

    // With activeReposOnly: inactive commit/identity/sync events are excluded; account events always pass.
    const filtered = await database.listPdsEvents({
      afterSeq: 0,
      domain: visDomain,
      activeReposOnly: true
    })
    expect(filtered.map((e) => e.seq)).toEqual(filteredExpected)

    // With activeReposOnly + maxBytes: same filtering applies.
    const filteredWithMaxBytes = await database.listPdsEvents({
      afterSeq: 0,
      domain: visDomain,
      activeReposOnly: true,
      maxBytes: 1024 * 1024
    })
    expect(filteredWithMaxBytes.map((e) => e.seq)).toEqual(filteredExpected)

    // Global sequence bounds remain unfiltered.
    expect(await database.getPdsEventSeqBounds()).toEqual({
      oldest: activeCommit.seq,
      newest: deletingAccount.seq
    })
  })

  it('skips pg_notify and pg_advisory_xact_lock on SQLite when appending PDS events', async () => {
    if (testDb.backend === 'pg') return

    const did = 'did:web:sqlite-notify.pds.example'
    const queries = await testDb.captureQueries(async () => {
      await database.appendPdsEvent({
        did,
        type: 'commit',
        payload: Buffer.from('sqlite-evt')
      })
    })
    expect(queries.some((q) => q.sql.toLowerCase().includes('pg_notify'))).toBe(
      false
    )
    expect(
      queries.some((q) => q.sql.toLowerCase().includes('pg_advisory_xact_lock'))
    ).toBe(false)
  })

  it.runIf(testDb.backend === 'pg')(
    'emits pg_notify in the same transaction on PostgreSQL for initializePdsRepo, commitPdsRepoWrite, and appendPdsEvent',
    async () => {
      const did = 'did:web:pg-notify.pds.example'
      const captureWithConnection = async (work: () => Promise<unknown>) => {
        const events: Array<{
          sql: string
          bindings: unknown[]
          connection: string
        }> = []
        const unsub = testDb.onQuery((event) => {
          events.push(event)
        })
        try {
          await work()
        } finally {
          unsub()
        }
        return events
      }

      const assertNotifyOrderInTx = (
        queries: Array<{
          sql: string
          bindings: unknown[]
          connection: string
        }>,
        expectedEventCount: number
      ) => {
        const beginIndex = queries.findIndex((q) =>
          q.sql.toLowerCase().startsWith('begin')
        )
        const commitIndex = queries.findIndex((q) =>
          q.sql.toLowerCase().startsWith('commit')
        )
        expect(beginIndex).toBeGreaterThanOrEqual(0)
        expect(commitIndex).toBeGreaterThan(beginIndex)

        const txConnection = queries[beginIndex].connection
        expect(queries[commitIndex].connection).toBe(txConnection)

        const lockIndices = queries.flatMap((q, idx) =>
          q.sql.toLowerCase().includes('pg_advisory_xact_lock') ? [idx] : []
        )
        const insertIndices = queries.flatMap((q, idx) =>
          q.sql.toLowerCase().includes('insert into "pds_events"') ? [idx] : []
        )
        const notifyIndices = queries.flatMap((q, idx) =>
          q.sql.toLowerCase().includes('pg_notify') ? [idx] : []
        )

        expect(lockIndices).toHaveLength(expectedEventCount)
        expect(insertIndices).toHaveLength(expectedEventCount)
        expect(notifyIndices).toHaveLength(expectedEventCount)

        for (let i = 0; i < expectedEventCount; i += 1) {
          const lockIndex = lockIndices[i]
          const insertIndex = insertIndices[i]
          const notifyIndex = notifyIndices[i]
          expect(lockIndex).toBeGreaterThan(beginIndex)
          expect(lockIndex).toBeLessThan(insertIndex)
          expect(insertIndex).toBeLessThan(notifyIndex)
          expect(notifyIndex).toBeLessThan(commitIndex)
          expect(queries[lockIndex].connection).toBe(txConnection)
          expect(queries[insertIndex].connection).toBe(txConnection)
          expect(queries[notifyIndex].connection).toBe(txConnection)
          expect(queries[lockIndex].bindings[0]).toBe(
            PDS_EVENTS_APPEND_LOCK_KEY
          )
          expect(queries[notifyIndex].bindings[0]).toBe(
            PDS_EVENTS_NOTIFY_CHANNEL
          )
        }
      }

      const initQueries = await captureWithConnection(async () => {
        await database.initializePdsRepo({
          did,
          actorId: 'https://pg-notify.example/users/alice',
          domain: 'pg-notify.example',
          signingKey: 'v1:key-pg',
          signingKeyDid: 'did:key:zQ3shPgNotify',
          rootCid: 'bafy-init-root',
          rev: '3k00000000001',
          blocks: [],
          events: [
            { type: 'identity', payload: Buffer.from('id') },
            { type: 'commit', payload: Buffer.from('cm') }
          ]
        })
      })
      assertNotifyOrderInTx(initQueries, 2)

      const commitQueries = await captureWithConnection(async () => {
        await database.commitPdsRepoWrite({
          did,
          rootCid: 'bafy-next-root',
          rev: '3k00000000002',
          expectedRev: '3k00000000001',
          blocks: [],
          recordWrites: [],
          event: { type: 'commit', payload: Buffer.from('cm2') }
        })
      })
      assertNotifyOrderInTx(commitQueries, 1)

      const standaloneQueries = await captureWithConnection(async () => {
        const ev = await database.appendPdsEvent({
          did,
          type: 'account',
          payload: Buffer.from('acct')
        })
        expect(ev.seq).toBeGreaterThan(0)
      })
      assertNotifyOrderInTx(standaloneQueries, 1)
    }
  )

  it.runIf(testDb.backend === 'pg')(
    'acquires pg_advisory_xact_lock before inserting pds_events in the same transaction on PostgreSQL for initializePdsRepo, commitPdsRepoWrite, and appendPdsEvent',
    async () => {
      const did = 'did:web:pg-lock.pds.example'
      const captureWithConnection = async (work: () => Promise<unknown>) => {
        const events: Array<{
          sql: string
          bindings: unknown[]
          connection: string
        }> = []
        const unsub = testDb.onQuery((event) => {
          events.push(event)
        })
        try {
          await work()
        } finally {
          unsub()
        }
        return events
      }

      const assertLockBeforeInsertsInTx = (
        queries: Array<{
          sql: string
          bindings: unknown[]
          connection: string
        }>,
        expectedEventCount: number
      ) => {
        const beginIndex = queries.findIndex((q) =>
          q.sql.toLowerCase().startsWith('begin')
        )
        const commitIndex = queries.findIndex((q) =>
          q.sql.toLowerCase().startsWith('commit')
        )
        expect(beginIndex).toBeGreaterThanOrEqual(0)
        expect(commitIndex).toBeGreaterThan(beginIndex)

        const txConnection = queries[beginIndex].connection
        expect(queries[commitIndex].connection).toBe(txConnection)

        const lockIndices = queries.flatMap((q, idx) =>
          q.sql.toLowerCase().includes('pg_advisory_xact_lock') ? [idx] : []
        )
        const insertIndices = queries.flatMap((q, idx) =>
          q.sql.toLowerCase().includes('insert into "pds_events"') ? [idx] : []
        )

        expect(lockIndices).toHaveLength(expectedEventCount)
        expect(insertIndices).toHaveLength(expectedEventCount)

        for (let i = 0; i < expectedEventCount; i += 1) {
          const lockIndex = lockIndices[i]
          const insertIndex = insertIndices[i]
          expect(lockIndex).toBeGreaterThan(beginIndex)
          expect(lockIndex).toBeLessThan(insertIndex)
          expect(insertIndex).toBeLessThan(commitIndex)
          expect(queries[lockIndex].connection).toBe(txConnection)
          expect(queries[insertIndex].connection).toBe(txConnection)
          expect(queries[lockIndex].bindings[0]).toBe(
            PDS_EVENTS_APPEND_LOCK_KEY
          )
        }
      }

      const initQueries = await captureWithConnection(async () => {
        await database.initializePdsRepo({
          did,
          actorId: 'https://pg-lock.example/users/alice',
          domain: 'pg-lock.example',
          signingKey: 'v1:key-pg-lock',
          signingKeyDid: 'did:key:zQ3shPgLock',
          rootCid: 'bafy-lock-init-root',
          rev: '3k00000000001',
          blocks: [],
          events: [
            { type: 'identity', payload: Buffer.from('id') },
            { type: 'commit', payload: Buffer.from('cm') }
          ]
        })
      })
      assertLockBeforeInsertsInTx(initQueries, 2)

      const commitQueries = await captureWithConnection(async () => {
        await database.commitPdsRepoWrite({
          did,
          rootCid: 'bafy-lock-next-root',
          rev: '3k00000000002',
          expectedRev: '3k00000000001',
          blocks: [],
          recordWrites: [],
          event: { type: 'commit', payload: Buffer.from('cm2') }
        })
      })
      assertLockBeforeInsertsInTx(commitQueries, 1)

      const standaloneQueries = await captureWithConnection(async () => {
        await database.appendPdsEvent({
          did,
          type: 'account',
          payload: Buffer.from('acct')
        })
      })
      assertLockBeforeInsertsInTx(standaloneQueries, 1)
    }
  )

  it('leaves a tombstone untouched: status and identity writes report no change', async () => {
    const did = 'did:plc:tombstonetest00000000000'
    await database.createPdsRepo({
      did,
      actorId: 'https://tombstone.example/users/alice',
      domain: 'tombstone.example',
      signingKey: 'v1:key-tombstone',
      signingKeyDid: 'did:key:zQ3shTombstone',
      handle: 'alice.tombstone.example'
    })
    expect(await database.updatePdsRepoStatus({ did, status: 'deleted' })).toBe(
      true
    )

    expect(
      await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    ).toBe(false)
    expect(await database.updatePdsRepoStatus({ did, status: 'deleted' })).toBe(
      false
    )
    expect(
      await database.updatePdsRepoIdentity({
        did,
        handle: 'bob.tombstone.example',
        plcOperation: '{"type":"plc_operation"}'
      })
    ).toBe(false)
    expect(await database.getPdsRepo({ did })).toMatchObject({
      status: 'deleted',
      actorId: `deleted:${did}`,
      handle: 'alice.tombstone.example',
      plcOperation: null
    })
    // A tombstone keeps its handle but no longer answers to it.
    expect(
      await database.getPdsRepoByHandle({ handle: 'alice.tombstone.example' })
    ).toBeNull()
  })

  it('updates a repo identity, resolves it by handle case-insensitively, and clears fields with null', async () => {
    const did = 'did:plc:identitytest000000000000'
    await database.createPdsRepo({
      did,
      actorId: 'https://identity.example/users/alice',
      domain: 'identity.example',
      signingKey: 'v1:key-identity',
      signingKeyDid: 'did:key:zQ3shIdentity'
    })

    expect(
      await database.updatePdsRepoIdentity({
        did,
        handle: 'Alice.Identity.Example',
        recoveryKeyDid: 'did:key:zQ3shRecovery',
        plcOperation: '{"type":"plc_operation"}'
      })
    ).toBe(true)

    expect(await database.getPdsRepo({ did })).toMatchObject({
      handle: 'Alice.Identity.Example',
      recoveryKeyDid: 'did:key:zQ3shRecovery',
      plcOperation: '{"type":"plc_operation"}'
    })

    // Omitted fields are left unchanged.
    await database.updatePdsRepoIdentity({
      did,
      handle: 'bob.identity.example'
    })
    expect(await database.getPdsRepo({ did })).toMatchObject({
      handle: 'bob.identity.example',
      recoveryKeyDid: 'did:key:zQ3shRecovery',
      plcOperation: '{"type":"plc_operation"}'
    })

    // An explicit null clears a field.
    await database.updatePdsRepoIdentity({
      did,
      recoveryKeyDid: null,
      plcOperation: null
    })
    expect(await database.getPdsRepo({ did })).toMatchObject({
      handle: 'bob.identity.example',
      recoveryKeyDid: null,
      plcOperation: null
    })

    expect(
      await database.getPdsRepoByHandle({ handle: 'BOB.IDENTITY.EXAMPLE' })
    ).toMatchObject({ did })
    expect(
      await database.getPdsRepoByHandle({ handle: '  bob.identity.example  ' })
    ).toMatchObject({ did })
    expect(
      await database.getPdsRepoByHandle({ handle: 'nobody.identity.example' })
    ).toBeNull()
    expect(await database.getPdsRepoByHandle({ handle: '   ' })).toBeNull()
  })

  it('upserts per-DID preferences', async () => {
    const did = 'did:plc:preferencestest0000000000'
    expect(await database.getPdsPreferences({ did })).toBeNull()

    await database.putPdsPreferences({
      did,
      preferences: [{ key: 'theme', value: 'dark' }]
    })
    expect(await database.getPdsPreferences({ did })).toEqual([
      { key: 'theme', value: 'dark' }
    ])

    await database.putPdsPreferences({ did, preferences: ['compact'] })
    expect(await database.getPdsPreferences({ did })).toEqual(['compact'])
  })

  it('deletes repo content and preferences but keeps the tombstone row and events', async () => {
    const did = 'did:plc:contenttest0000000000000'
    await database.createPdsRepo({
      did,
      actorId: 'https://content.example/users/alice',
      domain: 'content.example',
      signingKey: 'v1:key-content',
      signingKeyDid: 'did:key:zQ3shContent'
    })
    await database.createPdsBlob({
      did,
      cid: 'bafy-content-blob',
      mimeType: 'image/webp',
      size: 10,
      storageKey: `pds-blobs/${did}/bafy-content-blob`
    })
    await database.commitPdsRepoWrite({
      did,
      rootCid: 'bafy-content-root',
      rev: '3k00000000001',
      expectedRev: null,
      blocks: [{ cid: 'bafy-content-blk', bytes: Buffer.from([1, 2]) }],
      recordWrites: [
        {
          action: 'create',
          collection: 'app.bsky.feed.post',
          rkey: '3k1',
          cid: 'bafy-content-blk',
          blobCids: ['bafy-content-blob']
        }
      ],
      event: { type: 'commit', payload: Buffer.from('evt') }
    })
    await database.putPdsPreferences({ did, preferences: ['x'] })

    const { blobStorageKeys } = await database.deletePdsRepoContent({ did })
    expect(blobStorageKeys).toEqual([`pds-blobs/${did}/bafy-content-blob`])

    expect(await database.getPdsRepo({ did })).not.toBeNull()
    expect(await database.listPdsEvents({ afterSeq: 0, did })).toHaveLength(1)
    expect(
      await database.getPdsBlocks({ did, cids: ['bafy-content-blk'] })
    ).toEqual([])
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3k1'
      })
    ).toBeNull()
    expect(
      await database.getPdsBlob({ did, cid: 'bafy-content-blob' })
    ).toBeNull()
    expect(
      await database.getPdsRecordBlobs({
        did,
        recordUri: `at://${did}/app.bsky.feed.post/3k1`
      })
    ).toEqual([])
    // The account's preferences go with its content.
    expect(await database.getPdsPreferences({ did })).toBeNull()

    await database.deletePdsRepoData({ did })
    expect(await database.getPdsRepo({ did })).toBeNull()
  })
})

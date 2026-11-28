import { Secp256k1Keypair } from '@atproto/crypto'
import { cidForRawBytes, parseCid } from '@atproto/lex-data'
import {
  MemoryBlockstore,
  Repo,
  def,
  readCar,
  readCarWithRoot,
  verifyCommitSig,
  verifyDiffCar,
  verifyProofs,
  verifyRepoCar
} from '@atproto/repo'
import { AtUri } from '@atproto/syntax'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  MAX_PDS_COMMIT_BYTES,
  PdsDisabledError,
  PdsInvalidSwapError,
  PdsNotAllowedError,
  PdsReadOnlyRepoStorage,
  PdsRecordConflictError,
  PdsRecordNotFoundError,
  PdsRepoNotFoundError,
  PdsRepoUnavailableError,
  PdsSqlRepoStorage,
  PdsValidationError,
  applyPdsWrites,
  createPdsRecord,
  createPdsRepo,
  decodePdsEvent,
  deletePdsRecord,
  describePdsRepo,
  encryptPdsSigningKey,
  getPdsBlocksCar,
  getPdsBlocksCarStream,
  getPdsLatestCommit,
  getPdsRecordProofCar,
  getPdsRecordValue,
  getPdsRepoCar,
  getPdsRepoStatus,
  listPdsRecordValues,
  listPdsRepos,
  loadPdsSigningKey,
  pruneExpiredPdsEvents,
  putPdsRecord,
  resolveEffectivePdsRepoStatus,
  resolvePdsRepoDidForDomain,
  withPdsRepoLock
} from '@/lib/services/pds'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { logger } from '@/lib/utils/logger'

const FIXED_TEST_PRIVATE_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const FIXED_TEST_PRIVATE_KEY_BYTES = Buffer.from(
  FIXED_TEST_PRIVATE_KEY_HEX,
  'hex'
)
const FIXED_TEST_PRIVATE_KEY_BASE64 =
  FIXED_TEST_PRIVATE_KEY_BYTES.toString('base64')

const ALLOWED_USERNAMES = [
  'pds-lifecycle',
  'pds-swap',
  'pds-concurrent',
  'pds-dedup',
  'pds-validate',
  'pds-identical-diff',
  'pds-big-commit',
  'pds-no-secret',
  'pds-mod-suspended',
  'pds-mod-disabled',
  'pds-mod-deleting',
  'pds-rename-old',
  'bad_handle_user',
  'pds-stored-handle',
  'MixedCaseUser',
  'pds-many-records',
  'pds-gate-unconfirmed',
  'pds-gate-unapproved',
  'pds-gate-suspended',
  'pds-gate-disabled',
  'pds-gate-deleting',
  'pds-read-unapproved',
  'pds-read-unconfirmed',
  'pds-read-confirmed-code',
  'pds-list-budget',
  'pds-blocks-pages',
  'pds-off-switch'
]

const ENABLED_PDS_ENV = JSON.stringify({
  [TEST_DOMAIN]: {
    enabled: true,
    hostname: `pds.${TEST_DOMAIN}`,
    allowEmails: [`email-allowed@${TEST_DOMAIN}`, 'other-domain@other.test'],
    allowActors: ALLOWED_USERNAMES.map((u) => `${u}@${TEST_DOMAIN}`)
  },
  'disabled.test': {
    enabled: false,
    hostname: 'pds.disabled.test',
    allowEmails: [],
    allowActors: []
  }
})

/**
 * Verifies a sync-1.1 `#commit` event exactly as a relay does:
 * 1. Reads the event's CAR blocks and loads the commit + MST.
 * 2. Verifies the commit's signature against `didKey`.
 * 3. Inverts every op on the new MST (`create` -> delete, `update` -> restore prev,
 *    `delete` -> re-add prev) and asserts the resulting MST root equals `prevData`.
 */
const verifyCommitEventInversion = async (
  rawEvent: Parameters<typeof decodePdsEvent>[0],
  did: string,
  didKey: string
) => {
  const decoded = decodePdsEvent(rawEvent)
  expect(decoded.type).toBe('commit')
  if (decoded.type !== 'commit') {
    throw new Error('Expected commit event')
  }

  expect(decoded.repo).toBe(did)
  expect(decoded.seq).toBe(rawEvent.seq)
  expect(typeof decoded.time).toBe('string')
  expect(decoded.rebase).toBe(false)
  expect(decoded.tooBig).toBe(false)

  const { blocks, root } = await readCarWithRoot(decoded.blocks)
  expect(root.equals(decoded.commit)).toBe(true)

  const blockstore = new MemoryBlockstore(blocks)
  const commitObj = await blockstore.readObj(root, def.commit)
  expect(commitObj.did).toBe(did)
  expect(commitObj.rev).toBe(decoded.rev)
  expect(await verifyCommitSig(commitObj, didKey)).toBe(true)

  if (decoded.prevData) {
    const slice = await Repo.load(blockstore, root)
    let data = slice.data
    for (const op of decoded.ops) {
      if (op.action === 'create') {
        expect(op.cid).not.toBeNull()
        data = await data.delete(op.path)
      } else if (op.action === 'update') {
        expect(op.cid).not.toBeNull()
        expect(op.prev).toBeDefined()
        data = await data.update(op.path, op.prev!)
      } else if (op.action === 'delete') {
        expect(op.cid).toBeNull()
        expect(op.prev).toBeDefined()
        data = await data.add(op.path, op.prev!)
      } else {
        throw new Error(`Unexpected op action: ${String(op.action)}`)
      }
    }
    const invertedRoot = await data.getPointer()
    expect(invertedRoot.equals(decoded.prevData)).toBe(true)
  }

  return decoded
}

describe('PDS repository service', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  let fixedKey: Secp256k1Keypair

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.createServedDomain({ domain: TEST_DOMAIN, status: 'on' })
    fixedKey = await Secp256k1Keypair.import(FIXED_TEST_PRIVATE_KEY_BYTES, {
      exportable: true
    })
  })

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = ENABLED_PDS_ENV
  })

  const createLocalActor = async (
    username: string,
    {
      domain = TEST_DOMAIN,
      email = `${username.toLowerCase()}@${domain}`
    }: { domain?: string; email?: string } = {}
  ) => {
    await database.createAccount({
      email,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain,
      privateKey: `ap-priv-${username}`,
      publicKey: `ap-pub-${username}`
    })
    return `https://${domain}/users/${username}`
  }

  afterAll(async () => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    await database.destroy()
  })

  it('refuses createPdsRepo when PDS config is unset or disabled for the domain', async () => {
    delete process.env.ACTIVITIES_BLUESKY_PDS
    await expect(
      createPdsRepo(database, {
        did: 'did:web:off.pds.test',
        actorId: `https://${TEST_DOMAIN}/users/pds-off`,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsDisabledError)
    expect(
      await database.getPdsRepo({ did: 'did:web:off.pds.test' })
    ).toBeNull()

    process.env.ACTIVITIES_BLUESKY_PDS = ENABLED_PDS_ENV
    await expect(
      createPdsRepo(database, {
        did: 'did:web:disabled.pds.test',
        actorId: 'https://disabled.test/users/alice',
        domain: 'disabled.test',
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsDisabledError)
    expect(
      await database.getPdsRepo({ did: 'did:web:disabled.pds.test' })
    ).toBeNull()
  })

  it('creates a repo with an encrypted key, verifies full CAR, proofs, diffs, and invertible sync-1.1 commit events across create/update/delete', async () => {
    const did = 'did:web:lifecycle.pds.test'
    const actorUsername = 'pds-lifecycle'
    await database.createAccount({
      email: `${actorUsername}@${TEST_DOMAIN}`,
      username: actorUsername,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: 'ap-priv',
      publicKey: 'ap-pub'
    })
    const actorId = `https://${TEST_DOMAIN}/users/${actorUsername}`

    const created = await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      handle: `${actorUsername}.${TEST_DOMAIN}`,
      signingKey: fixedKey
    })

    // Signing key in pds_repos must be encrypted (v1 envelope) and excluded from default selects.
    const storedRepo = await database.getPdsRepo({ did })
    expect(storedRepo).not.toBeNull()
    expect('signingKey' in storedRepo!).toBe(false)
    expect(storedRepo!.signingKeyDid).toBe(fixedKey.did())
    const encryptedSigningKey = await database.getPdsRepoSigningKey({ did })
    expect(encryptedSigningKey).toMatch(/^v1:/)
    expect(encryptedSigningKey).not.toContain(FIXED_TEST_PRIVATE_KEY_HEX)
    expect(encryptedSigningKey).not.toContain(FIXED_TEST_PRIVATE_KEY_BASE64)
    const reloadedKey = await loadPdsSigningKey({
      did,
      signingKey: encryptedSigningKey!
    })
    expect(reloadedKey.did()).toBe(fixedKey.did())

    // Initial events: #identity, #account (active), #commit in strictly increasing seq order.
    const initEvents = await database.listPdsEvents({ afterSeq: 0, did })
    expect(initEvents.map((e) => e.type)).toEqual([
      'identity',
      'account',
      'commit'
    ])
    expect(initEvents[0].seq).toBeLessThan(initEvents[1].seq)
    expect(initEvents[1].seq).toBeLessThan(initEvents[2].seq)

    const idEvt = decodePdsEvent(initEvents[0])
    expect(idEvt).toMatchObject({
      type: 'identity',
      did,
      handle: `${actorUsername}.${TEST_DOMAIN}`
    })
    const acctEvt = decodePdsEvent(initEvents[1])
    expect(acctEvt).toMatchObject({
      type: 'account',
      did,
      active: true
    })
    await verifyCommitEventInversion(initEvents[2], did, fixedKey.did())

    // Initial empty repo CAR verifies cleanly.
    const emptyCar = await getPdsRepoCar(database, { did })
    const verifiedEmpty = await verifyRepoCar(emptyCar, did, fixedKey.did())
    expect(verifiedEmpty.creates).toEqual([])
    expect(verifiedEmpty.commit.cid.toString()).toBe(created.commit.cid)

    let lastSeq = initEvents[2].seq
    const collection = 'app.bsky.feed.post'

    // 1. Create a record with generated TID rkey.
    const post1 = await createPdsRecord(database, {
      did,
      collection,
      record: {
        $type: collection,
        text: 'Hello ATProto!',
        createdAt: '2026-11-25T00:00:00.000Z'
      }
    })
    const post1Uri = new AtUri(post1.uri)
    expect(post1.seq).toBeGreaterThan(lastSeq)
    lastSeq = post1.seq

    // Verify full repo CAR after create.
    const carAfterCreate1 = await getPdsRepoCar(database, { did })
    const verified1 = await verifyRepoCar(carAfterCreate1, did, fixedKey.did())
    expect(verified1.creates).toHaveLength(1)
    expect(verified1.creates[0].cid.toString()).toBe(post1.cid)

    // Verify record proof CAR proves existence.
    const proof1 = await getPdsRecordProofCar(database, {
      did,
      collection,
      rkey: post1Uri.rkey
    })
    const proofRes1 = await verifyProofs(
      proof1,
      [{ collection, rkey: post1Uri.rkey, cid: parseCid(post1.cid) }],
      did,
      fixedKey.did()
    )
    expect(proofRes1.verified).toHaveLength(1)
    expect(proofRes1.unverified).toHaveLength(0)

    // Verify #commit event inversion against prevData.
    const eventsAfterCreate1 = await database.listPdsEvents({
      afterSeq: initEvents[2].seq,
      did
    })
    expect(eventsAfterCreate1).toHaveLength(1)
    await verifyCommitEventInversion(eventsAfterCreate1[0], did, fixedKey.did())

    // Snapshot the client's view of the repo before further writes for `since` diff test.
    const clientBlockstore = new MemoryBlockstore()
    await clientBlockstore.applyCommit(verified1.commit)
    const repoAtCreate1 = await Repo.load(
      clientBlockstore,
      verified1.commit.cid
    )

    // 2. Batch create several records (including one with a blob ref) to build a multi-node MST.
    const fakeBlobCid = await cidForRawBytes(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    )
    const batchWrites = Array.from({ length: 12 }, (_, idx) => ({
      action: 'create' as const,
      collection,
      rkey: `3ktestpost${String(idx).padStart(4, '0')}`,
      record: {
        $type: collection,
        text: `Batch post #${idx}`,
        ...(idx === 0
          ? {
              embed: {
                $type: 'app.bsky.embed.images',
                images: [
                  {
                    alt: 'sample',
                    image: {
                      $type: 'blob',
                      ref: { $link: fakeBlobCid.toString() },
                      mimeType: 'image/png',
                      size: 8
                    }
                  }
                ]
              }
            }
          : {}),
        createdAt: `2026-11-25T00:00:${String(idx).padStart(2, '0')}.000Z`
      }
    }))
    const batchResult = await applyPdsWrites(database, {
      did,
      writes: batchWrites,
      swapCommit: post1.commit.cid
    })
    expect(batchResult.results).toHaveLength(12)
    expect(batchResult.seq).toBeGreaterThan(lastSeq)
    lastSeq = batchResult.seq

    // Blob ref in batch item 0 should be indexed in pds_record_blobs.
    expect(
      await database.getPdsRecordBlobs({
        did,
        recordUri: batchResult.results[0].uri
      })
    ).toEqual([fakeBlobCid.toString()])

    // Verify full repo CAR + diff CAR (`since`) + commit event inversion.
    const carAfterBatch = await getPdsRepoCar(database, { did })
    const verifiedBatch = await verifyRepoCar(
      carAfterBatch,
      did,
      fixedKey.did()
    )
    expect(verifiedBatch.creates).toHaveLength(13)

    const diffCar = await getPdsRepoCar(database, {
      did,
      since: post1.commit.rev
    })
    const verifiedDiff = await verifyDiffCar(
      repoAtCreate1,
      diffCar,
      did,
      fixedKey.did()
    )
    expect(verifiedDiff.writes).toHaveLength(12)

    const batchEvent = (
      await database.listPdsEvents({ afterSeq: post1.seq, did })
    )[0]
    await verifyCommitEventInversion(batchEvent, did, fixedKey.did())

    // 3. Update post1 via putPdsRecord, then verify no-op putPdsRecord.
    const updated1 = await putPdsRecord(database, {
      did,
      collection,
      rkey: post1Uri.rkey,
      record: {
        $type: collection,
        text: 'Hello ATProto (edited)!',
        createdAt: '2026-11-25T00:00:00.000Z'
      }
    })
    expect(updated1.commit).not.toBeNull()
    expect(updated1.seq).toBeGreaterThan(lastSeq)
    lastSeq = updated1.seq!

    const noopPut = await putPdsRecord(database, {
      did,
      collection,
      rkey: post1Uri.rkey,
      record: {
        $type: collection,
        text: 'Hello ATProto (edited)!',
        createdAt: '2026-11-25T00:00:00.000Z'
      }
    })
    expect(noopPut.commit).toBeNull()
    expect(noopPut.cid).toBe(updated1.cid)

    const carAfterUpdate = await getPdsRepoCar(database, { did })
    await verifyRepoCar(carAfterUpdate, did, fixedKey.did())
    const proofAfterUpdate = await getPdsRecordProofCar(database, {
      did,
      collection,
      rkey: post1Uri.rkey
    })
    const proofUpdateRes = await verifyProofs(
      proofAfterUpdate,
      [{ collection, rkey: post1Uri.rkey, cid: parseCid(updated1.cid) }],
      did,
      fixedKey.did()
    )
    expect(proofUpdateRes.verified).toHaveLength(1)

    const updateEvent = (
      await database.listPdsEvents({ afterSeq: batchResult.seq, did })
    )[0]
    await verifyCommitEventInversion(updateEvent, did, fixedKey.did())

    // 4. Delete post1 and verify absence proof + invertible #commit event.
    const del1 = await deletePdsRecord(database, {
      did,
      collection,
      rkey: post1Uri.rkey
    })
    expect(del1.deleted).toBe(true)
    expect(del1.seq).toBeGreaterThan(lastSeq)
    lastSeq = del1.seq!

    // Deleting an already-absent record is a no-op.
    const delAgain = await deletePdsRecord(database, {
      did,
      collection,
      rkey: post1Uri.rkey
    })
    expect(delAgain).toEqual({ deleted: false, commit: null, seq: null })

    const carAfterDelete = await getPdsRepoCar(database, { did })
    const verifiedAfterDelete = await verifyRepoCar(
      carAfterDelete,
      did,
      fixedKey.did()
    )
    expect(verifiedAfterDelete.creates).toHaveLength(12)

    const absenceProof = await getPdsRecordProofCar(database, {
      did,
      collection,
      rkey: post1Uri.rkey
    })
    const absenceRes = await verifyProofs(
      absenceProof,
      [{ collection, rkey: post1Uri.rkey, cid: null }],
      did,
      fixedKey.did()
    )
    expect(absenceRes.verified).toHaveLength(1)
    expect(absenceRes.unverified).toHaveLength(0)

    const deleteEvent = (
      await database.listPdsEvents({ afterSeq: updated1.seq!, did })
    )[0]
    await verifyCommitEventInversion(deleteEvent, did, fixedKey.did())

    // 5. Mixed applyPdsWrites (create + update + delete in a single commit).
    const mixed = await applyPdsWrites(database, {
      did,
      writes: [
        {
          action: 'create',
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
          record: {
            $type: 'app.bsky.actor.profile',
            displayName: 'Alice'
          }
        },
        {
          action: 'update',
          collection,
          rkey: '3ktestpost0000',
          record: {
            $type: collection,
            text: 'Updated batch post 0 (blob removed)',
            createdAt: '2026-11-25T00:00:00.000Z'
          }
        },
        {
          action: 'delete',
          collection,
          rkey: '3ktestpost0001'
        }
      ]
    })
    expect(mixed.seq).toBeGreaterThan(lastSeq)

    // Blob ref removed when record was updated without the blob.
    expect(
      await database.getPdsRecordBlobs({
        did,
        recordUri: batchResult.results[0].uri
      })
    ).toEqual([])

    const carAfterMixed = await getPdsRepoCar(database, { did })
    await verifyRepoCar(carAfterMixed, did, fixedKey.did())
    const mixedEvent = (
      await database.listPdsEvents({ afterSeq: del1.seq!, did })
    )[0]
    await verifyCommitEventInversion(mixedEvent, did, fixedKey.did())

    // 6. Sync & Repo read helpers.
    const latest = await getPdsLatestCommit(database, { did })
    expect(latest).toEqual(mixed.commit)

    const status = await getPdsRepoStatus(database, { did })
    expect(status).toEqual({
      did,
      active: true,
      rev: mixed.commit.rev
    })

    const listedRepos = await listPdsRepos(database, { domain: TEST_DOMAIN })
    expect(listedRepos.repos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          did,
          head: mixed.commit.cid,
          rev: mixed.commit.rev,
          active: true
        })
      ])
    )

    const described = await describePdsRepo(database, { did })
    expect(described.did).toBe(did)
    expect(described.handle).toBe(`${actorUsername}.${TEST_DOMAIN}`)
    expect(described.handleIsCorrect).toBe(true)
    expect(described.collections).toEqual([
      'app.bsky.actor.profile',
      'app.bsky.feed.post'
    ])
    expect(described.didDoc).toMatchObject({
      id: did,
      verificationMethod: [
        expect.objectContaining({
          publicKeyMultibase: fixedKey.did().replace(/^did:key:/, '')
        })
      ]
    })

    const profileValue = await getPdsRecordValue(database, {
      did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self'
    })
    expect(profileValue).toMatchObject({
      uri: `at://${did}/app.bsky.actor.profile/self`,
      value: {
        $type: 'app.bsky.actor.profile',
        displayName: 'Alice'
      }
    })
    expect(
      await getPdsRecordValue(database, {
        did,
        collection,
        rkey: post1Uri.rkey
      })
    ).toBeNull()

    const listPage1 = await listPdsRecordValues(database, {
      did,
      collection,
      limit: 5
    })
    expect(listPage1.records).toHaveLength(5)
    expect(listPage1.cursor).toBeDefined()
    const listPage2 = await listPdsRecordValues(database, {
      did,
      collection,
      cursor: listPage1.cursor,
      limit: 20
    })
    expect(listPage2.records).toHaveLength(6)
    expect(listPage2.cursor).toBeUndefined()

    const blocksCar = await getPdsBlocksCar(database, {
      did,
      cids: [mixed.commit.cid, profileValue!.cid]
    })
    const parsedBlocksCar = await readCar(blocksCar)
    expect(parsedBlocksCar.roots).toEqual([])
    expect(parsedBlocksCar.blocks.has(parseCid(mixed.commit.cid))).toBe(true)
    expect(parsedBlocksCar.blocks.has(parseCid(profileValue!.cid))).toBe(true)

    // Verify all events for this DID have strictly increasing seqs.
    const allEvents = await database.listPdsEvents({ afterSeq: 0, did })
    for (let i = 1; i < allEvents.length; i++) {
      expect(allEvents[i].seq).toBeGreaterThan(allEvents[i - 1].seq)
    }
  })

  it('rejects stale swapCommit and preserves repo state', async () => {
    const did = 'did:web:swap.pds.test'
    const actorId = await createLocalActor('pds-swap')
    const created = await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const first = await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'first'
      },
      swapCommit: created.commit.cid
    })

    // Re-using the initial commit CID must fail with PdsInvalidSwapError.
    await expect(
      applyPdsWrites(database, {
        did,
        writes: [
          {
            action: 'create',
            collection: 'app.bsky.feed.post',
            record: { $type: 'app.bsky.feed.post', text: 'stale' }
          }
        ],
        swapCommit: created.commit.cid
      })
    ).rejects.toBeInstanceOf(PdsInvalidSwapError)

    expect(await getPdsLatestCommit(database, { did })).toEqual(first.commit)
  })

  it('serializes concurrent writes without losing any write', async () => {
    const did = 'did:web:concurrent.pds.test'
    const actorId = await createLocalActor('pds-concurrent')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const count = 8
    const results = await Promise.all(
      Array.from({ length: count }, (_, idx) =>
        createPdsRecord(database, {
          did,
          collection: 'app.bsky.feed.post',
          rkey: `3kconc${String(idx).padStart(4, '0')}`,
          record: {
            $type: 'app.bsky.feed.post',
            text: `Concurrent post ${idx}`
          }
        })
      )
    )

    expect(results).toHaveLength(count)
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b)
    expect(new Set(seqs).size).toBe(count)

    const fullCar = await getPdsRepoCar(database, { did })
    const verified = await verifyRepoCar(fullCar, did, fixedKey.did())
    expect(verified.creates).toHaveLength(count)

    // Every sequenced #commit event must invert back to its prevData cleanly.
    const events = await database.listPdsEvents({ afterSeq: 0, did })
    const commitEvents = events.filter((e) => e.type === 'commit')
    expect(commitEvents).toHaveLength(count + 1)
    for (const evt of commitEvents) {
      await verifyCommitEventInversion(evt, did, fixedKey.did())
    }
  })

  it('keeps shared record block alive when one of two identical records is deleted', async () => {
    const did = 'did:web:dedup.pds.test'
    const actorId = await createLocalActor('pds-dedup')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const sameRecord = {
      $type: 'app.bsky.feed.post',
      text: 'identical content'
    }
    const r1 = await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3kdup0001',
      record: sameRecord
    })
    const r2 = await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3kdup0002',
      record: sameRecord
    })
    expect(r1.cid).toBe(r2.cid)

    await deletePdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3kdup0001'
    })

    const remaining = await getPdsRecordValue(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3kdup0002'
    })
    expect(remaining?.value).toEqual(sameRecord)

    const fullCar = await getPdsRepoCar(database, { did })
    const verified = await verifyRepoCar(fullCar, did, fixedKey.did())
    expect(verified.creates).toHaveLength(1)
  })

  it('validates collection NSID, rkey, $type, AT Data Model rules, and 1 MiB record cap', async () => {
    const did = 'did:web:validate.pds.test'
    const actorId = await createLocalActor('pds-validate')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // Invalid NSID
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'not a valid nsid',
        record: { $type: 'not a valid nsid' }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Invalid rkey
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '../escape',
        record: { $type: 'app.bsky.feed.post', text: 'bad' }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Missing or mismatched $type
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: { text: 'no type' }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: { $type: 'app.bsky.actor.profile', displayName: 'mismatch' }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Floats are invalid in the AT Data Model
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: { $type: 'app.bsky.feed.post', score: 3.14 }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Legacy blob refs are rejected
    const legacyBlobCid = await cidForRawBytes(new Uint8Array([1, 2, 3]))
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          thumb: { cid: legacyBlobCid.toString(), mimeType: 'image/png' }
        }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Record exceeding 1 MiB CBOR is rejected
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'a'.repeat(1024 * 1024 + 100)
        }
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Duplicate create and missing update/delete errors
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3konlyone',
      record: { $type: 'app.bsky.feed.post', text: 'once' }
    })
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3konlyone',
        record: { $type: 'app.bsky.feed.post', text: 'twice' }
      })
    ).rejects.toBeInstanceOf(PdsRecordConflictError)

    await expect(
      applyPdsWrites(database, {
        did,
        writes: [
          {
            action: 'update',
            collection: 'app.bsky.feed.post',
            rkey: '3kmissing',
            record: { $type: 'app.bsky.feed.post', text: 'nope' }
          }
        ]
      })
    ).rejects.toBeInstanceOf(PdsRecordNotFoundError)

    // Deactivated repo refuses writes and public reads, while status reports inactive.
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    expect(await getPdsRepoStatus(database, { did })).toEqual({
      did,
      active: false,
      status: 'deactivated'
    })
    await expect(getPdsRepoCar(database, { did })).rejects.toBeInstanceOf(
      PdsRepoUnavailableError
    )
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: { $type: 'app.bsky.feed.post', text: 'blocked' }
      })
    ).rejects.toBeInstanceOf(PdsRepoUnavailableError)
  })

  it('supports Repo.create, Repo.load, and repo.formatCommit directly on PdsSqlRepoStorage', async () => {
    const did = 'did:web:direct-storage.pds.test'
    const storage = new PdsSqlRepoStorage(database, did)

    const repo = await Repo.create(storage, did, fixedKey)
    expect(storage.getStagedRoot()?.cid.equals(repo.cid)).toBe(true)
    expect(storage.getStagedBlocks().size).toBeGreaterThan(0)

    const reloaded = await Repo.load(storage, repo.cid)
    expect(reloaded.did).toBe(did)

    const nextCommit = await reloaded.formatCommit(
      {
        action: 'create' as never,
        collection: 'app.bsky.feed.post',
        rkey: '3kdirect0001',
        record: { $type: 'app.bsky.feed.post', text: 'direct' }
      },
      fixedKey
    )
    await storage.applyCommit(nextCommit)
    expect(await storage.has(nextCommit.cid)).toBe(true)
    expect((await storage.getRoot())?.equals(nextCommit.cid)).toBe(true)
  })

  it('prunes pds_events older than 7 days while keeping recent events', async () => {
    const did = 'did:web:prune.pds.test'
    const now = Date.UTC(2026, 10, 25, 12, 0, 0)
    const dayMs = 24 * 60 * 60 * 1000

    const oldEvt = await database.appendPdsEvent({
      did,
      type: 'identity',
      payload: Buffer.from([0xa0]),
      createdAt: now - 8 * dayMs
    })
    const recentEvt = await database.appendPdsEvent({
      did,
      type: 'identity',
      payload: Buffer.from([0xa0]),
      createdAt: now - 2 * dayMs
    })

    const deleted = await pruneExpiredPdsEvents(database, { now })
    expect(deleted).toBeGreaterThanOrEqual(1)

    const remaining = await database.listPdsEvents({ afterSeq: 0, did })
    expect(remaining.map((e) => e.seq)).toEqual([recentEvt.seq])
    expect(remaining.map((e) => e.seq)).not.toContain(oldEvt.seq)
  })

  it('rejects transplanting an encrypted signing key to another DID and runs describePdsRepo without ACTIVITIES_SECRET_PHASE', async () => {
    const didA = 'did:web:transplant-a.pds.test'
    const didB = 'did:web:transplant-b.pds.test'
    const envelope = await encryptPdsSigningKey(fixedKey, didA)

    const loadedA = await loadPdsSigningKey({ did: didA, signingKey: envelope })
    expect(loadedA.did()).toBe(fixedKey.did())
    await expect(
      loadPdsSigningKey({ did: didB, signingKey: envelope })
    ).rejects.toThrow()

    // describePdsRepo must read signingKeyDid and never need ACTIVITIES_SECRET_PHASE.
    const noSecretDid = 'did:web:no-secret.pds.test'
    const actorId = await createLocalActor('pds-no-secret')
    await createPdsRepo(database, {
      did: noSecretDid,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const originalSecret = process.env.ACTIVITIES_SECRET_PHASE
    process.env.ACTIVITIES_SECRET_PHASE = ''
    try {
      const described = await describePdsRepo(database, { did: noSecretDid })
      expect(described.didDoc).toMatchObject({
        id: noSecretDid,
        verificationMethod: [
          expect.objectContaining({
            publicKeyMultibase: fixedKey.did().replace(/^did:key:/, '')
          })
        ]
      })
    } finally {
      if (originalSecret === undefined) {
        delete process.env.ACTIVITIES_SECRET_PHASE
      } else {
        process.env.ACTIVITIES_SECRET_PHASE = originalSecret
      }
    }
  })

  it('verifies diff CAR since rev1 when rev2 creates a post with identical content to rev1', async () => {
    const did = 'did:web:identical-diff.pds.test'
    const actorId = await createLocalActor('pds-identical-diff')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const identicalRecord = {
      $type: 'app.bsky.feed.post',
      text: 'exact same content at rev1 and rev2',
      createdAt: '2026-11-25T00:00:00.000Z'
    }

    const r1 = await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3kident0001',
      record: identicalRecord
    })
    const carAtRev1 = await getPdsRepoCar(database, { did })
    const verifiedAtRev1 = await verifyRepoCar(carAtRev1, did, fixedKey.did())
    const clientBlockstore = new MemoryBlockstore()
    await clientBlockstore.applyCommit(verifiedAtRev1.commit)
    const repoAtRev1 = await Repo.load(
      clientBlockstore,
      verifiedAtRev1.commit.cid
    )

    const r2 = await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3kident0002',
      record: identicalRecord
    })
    expect(r2.cid).toBe(r1.cid)

    const diffCar = await getPdsRepoCar(database, {
      did,
      since: r1.commit.rev
    })
    // Diff CAR must contain the re-referenced record block because putPdsBlocks updated repoRev.
    const parsedDiff = await readCarWithRoot(diffCar)
    expect(parsedDiff.blocks.has(parseCid(r2.cid))).toBe(true)

    const verifiedDiff = await verifyDiffCar(
      repoAtRev1,
      diffCar,
      did,
      fixedKey.did()
    )
    expect(verifiedDiff.writes).toHaveLength(1)
  })

  it('enforces MAX_PDS_COMMIT_BYTES = 2_000_000 on the framed #commit CAR blocks', async () => {
    expect(MAX_PDS_COMMIT_BYTES).toBe(2_000_000)

    const did = 'did:web:big-commit.pds.test'
    const actorId = await createLocalActor('pds-big-commit')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // Two ~999,900-byte records: each is under 1 MiB, their raw block byte sum is
    // below 2_000_000 (and well below 2 MiB), but CAR framing + MST + commit blocks
    // push the framed CAR over 2_000_000 bytes.
    const chunkA = 'a'.repeat(999_800)
    const chunkB = 'b'.repeat(999_800)

    await expect(
      applyPdsWrites(database, {
        did,
        writes: [
          {
            action: 'create',
            collection: 'app.bsky.feed.post',
            rkey: '3kbig0001',
            record: { $type: 'app.bsky.feed.post', text: chunkA }
          },
          {
            action: 'create',
            collection: 'app.bsky.feed.post',
            rkey: '3kbig0002',
            record: { $type: 'app.bsky.feed.post', text: chunkB }
          }
        ]
      })
    ).rejects.toBeInstanceOf(PdsValidationError)
  })

  it('logs and swallows releaseImportLock errors without failing a committed write or masking fn errors', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => {})
    try {
      const mockDb = {
        acquireImportLock: vi.fn().mockResolvedValue({ token: 'tok-1' }),
        releaseImportLock: vi
          .fn()
          .mockRejectedValue(new Error('DB hiccup on unlock'))
      } as unknown as typeof database

      const result = await withPdsRepoLock(
        mockDb,
        'did:web:lock-ok.pds.test',
        async () => 'committed-value'
      )
      expect(result).toBe('committed-value')
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          did: 'did:web:lock-ok.pds.test',
          err: expect.any(Error)
        })
      )

      loggerErrorSpy.mockClear()
      await expect(
        withPdsRepoLock(mockDb, 'did:web:lock-err.pds.test', async () => {
          throw new Error('primary write failure')
        })
      ).rejects.toThrow('primary write failure')
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          did: 'did:web:lock-err.pds.test',
          err: expect.any(Error)
        })
      )
    } finally {
      loggerErrorSpy.mockRestore()
    }
  })

  it('enforces allowlist, local actor domain match, and DID <= 255 in createPdsRepo', async () => {
    // Disallowed local actor (neither email nor username@domain in allowlist) -> PdsNotAllowedError.
    const disallowedActorId = await createLocalActor('not-allowed-user')
    await expect(
      createPdsRepo(database, {
        did: 'did:web:disallowed.pds.test',
        actorId: disallowedActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)

    // Allowlist by account email works even when username@domain is not in allowActors.
    const emailAllowedActorId = await createLocalActor('by-email-only', {
      email: `email-allowed@${TEST_DOMAIN}`
    })
    const createdByEmail = await createPdsRepo(database, {
      did: 'did:web:email-allowed.pds.test',
      actorId: emailAllowedActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    expect(createdByEmail.repo.actorId).toBe(emailAllowedActorId)

    // Unknown actorId -> PdsValidationError.
    await expect(
      createPdsRepo(database, {
        did: 'did:web:unknown-actor.pds.test',
        actorId: `https://${TEST_DOMAIN}/users/does-not-exist`,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Actor belonging to a different domain -> PdsValidationError.
    const otherDomainActorId = await createLocalActor('other-domain-user', {
      domain: 'other.test',
      email: 'other-domain@other.test'
    })
    await expect(
      createPdsRepo(database, {
        did: 'did:web:wrong-domain.pds.test',
        actorId: otherDomainActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsValidationError)

    // Valid DID longer than 255 characters -> PdsValidationError.
    const longDid = `did:web:${'a'.repeat(245)}.test`
    expect(longDid.length).toBeGreaterThan(255)
    await expect(
      createPdsRepo(database, {
        did: longDid,
        actorId: emailAllowedActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsValidationError)
  })

  it('treats suspended actors, disabled accounts, and deleting actors as takendown or deactivated', async () => {
    const suspendedDid = 'did:web:mod-suspended.pds.test'
    const suspendedActorId = await createLocalActor('pds-mod-suspended')
    await createPdsRepo(database, {
      did: suspendedDid,
      actorId: suspendedActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const disabledDid = 'did:web:mod-disabled.pds.test'
    const disabledActorId = await createLocalActor('pds-mod-disabled')
    await createPdsRepo(database, {
      did: disabledDid,
      actorId: disabledActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const deletingDid = 'did:web:mod-deleting.pds.test'
    const deletingActorId = await createLocalActor('pds-mod-deleting')
    await createPdsRepo(database, {
      did: deletingDid,
      actorId: deletingActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // 1. Suspended actor -> takendown.
    await database.setActorSuspended({
      actorId: suspendedActorId,
      suspended: true
    })
    await expect(
      getPdsRepoCar(database, { did: suspendedDid })
    ).rejects.toMatchObject({
      name: 'PdsRepoUnavailableError',
      code: 'RepoTakendown',
      repoStatus: 'takendown'
    })
    await expect(
      describePdsRepo(database, { did: suspendedDid })
    ).rejects.toMatchObject({ code: 'RepoTakendown' })
    expect(await getPdsRepoStatus(database, { did: suspendedDid })).toEqual({
      did: suspendedDid,
      active: false,
      status: 'takendown'
    })

    // 2. Disabled account -> takendown.
    const disabledActor = await database.getActorFromId({ id: disabledActorId })
    await database.setAccountDisabled({
      accountId: disabledActor!.account!.id,
      disabled: true
    })
    await expect(
      getPdsLatestCommit(database, { did: disabledDid })
    ).rejects.toMatchObject({
      name: 'PdsRepoUnavailableError',
      code: 'RepoTakendown',
      repoStatus: 'takendown'
    })
    expect(await getPdsRepoStatus(database, { did: disabledDid })).toEqual({
      did: disabledDid,
      active: false,
      status: 'takendown'
    })

    // 3. Scheduled and deleting actor -> deactivated.
    await database.scheduleActorDeletion({
      actorId: deletingActorId,
      scheduledAt: new Date(Date.now() + 60_000)
    })
    await expect(
      getPdsRepoCar(database, { did: deletingDid })
    ).rejects.toMatchObject({
      name: 'PdsRepoUnavailableError',
      code: 'RepoDeactivated',
      repoStatus: 'deactivated'
    })
    expect(await getPdsRepoStatus(database, { did: deletingDid })).toEqual({
      did: deletingDid,
      active: false,
      status: 'deactivated'
    })

    await database.startActorDeletion({ actorId: deletingActorId })
    await expect(
      getPdsRepoCar(database, { did: deletingDid })
    ).rejects.toMatchObject({ code: 'RepoDeactivated' })

    // listPdsRepos reflects effective moderation/deletion status too.
    const listed = await listPdsRepos(database, { domain: TEST_DOMAIN })
    const byDid = new Map(listed.repos.map((r) => [r.did, r]))
    expect(byDid.get(suspendedDid)).toMatchObject({
      active: false,
      status: 'takendown'
    })
    expect(byDid.get(disabledDid)).toMatchObject({
      active: false,
      status: 'takendown'
    })
    expect(byDid.get(deletingDid)).toMatchObject({
      active: false,
      status: 'deactivated'
    })
  })

  it('resolves only current handles (not retired actor_handles) and marks invalid ATProto handles as handle.invalid', async () => {
    const renameDid = 'did:web:rename.pds.test'
    const renameActorId = await createLocalActor('pds-rename-old')
    await createPdsRepo(database, {
      did: renameDid,
      actorId: renameActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // Current handle resolves to the DID.
    expect(
      await resolvePdsRepoDidForDomain(database, {
        repo: `pds-rename-old.${TEST_DOMAIN}`,
        domain: TEST_DOMAIN
      })
    ).toBe(renameDid)

    // Rename the actor: old handle is now retired in actor_handles.
    const renamed = await database.recordActorHandleRename({
      actorId: renameActorId,
      username: 'pds-rename-new',
      domain: TEST_DOMAIN,
      now: new Date(),
      cooldownMs: 0
    })
    expect(renamed.ok).toBe(true)

    // Sanity check: getActorFromUsername still resolves the retired handle,
    // but resolvePdsRepoDidForDomain MUST refuse it.
    expect(
      await database.getActorFromUsername({
        username: 'pds-rename-old',
        domain: TEST_DOMAIN
      })
    ).not.toBeNull()
    await expect(
      resolvePdsRepoDidForDomain(database, {
        repo: `pds-rename-old.${TEST_DOMAIN}`,
        domain: TEST_DOMAIN
      })
    ).rejects.toBeInstanceOf(PdsRepoNotFoundError)

    // New current handle resolves cleanly.
    expect(
      await resolvePdsRepoDidForDomain(database, {
        repo: `pds-rename-new.${TEST_DOMAIN}`,
        domain: TEST_DOMAIN
      })
    ).toBe(renameDid)

    // Username with underscore is not a valid ATProto handle -> handle.invalid + handleIsCorrect: false.
    const invalidHandleDid = 'did:web:bad-handle.pds.test'
    const badHandleActorId = await createLocalActor('bad_handle_user')
    await createPdsRepo(database, {
      did: invalidHandleDid,
      actorId: badHandleActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const badDescribed = await describePdsRepo(database, {
      did: invalidHandleDid
    })
    expect(badDescribed.handle).toBe('handle.invalid')
    expect(badDescribed.handleIsCorrect).toBe(false)
    expect(badDescribed.didDoc).not.toHaveProperty('alsoKnownAs')

    // Legacy mixed-case valid username is lowercased in describePdsRepo.
    const mixedCaseDid = 'did:web:mixed-case.pds.test'
    const mixedCaseActorId = await createLocalActor('mixedcaseuser')
    await testDb.db
      .updateTable('actors')
      .set({ username: 'MixedCaseUser' })
      .where('id', '=', mixedCaseActorId)
      .execute()
    await createPdsRepo(database, {
      did: mixedCaseDid,
      actorId: mixedCaseActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const mixedDescribed = await describePdsRepo(database, {
      did: mixedCaseDid
    })
    expect(mixedDescribed.handle).toBe(`mixedcaseuser.${TEST_DOMAIN}`)
    expect(mixedDescribed.handleIsCorrect).toBe(true)
  })

  it('resolves and describes a repo by its stored handle, not <username>.<domain>', async () => {
    const did = 'did:plc:storedhandle00000000000000'
    const actorId = await createLocalActor('pds-stored-handle')
    const handle = `pds-stored-handle.pds.${TEST_DOMAIN}`
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      handle,
      signingKey: fixedKey
    })

    expect(
      await resolvePdsRepoDidForDomain(database, {
        repo: handle.toUpperCase(),
        domain: TEST_DOMAIN
      })
    ).toBe(did)
    await expect(
      resolvePdsRepoDidForDomain(database, {
        repo: `pds-stored-handle.${TEST_DOMAIN}`,
        domain: TEST_DOMAIN
      })
    ).rejects.toBeInstanceOf(PdsRepoNotFoundError)
    // Another domain's request does not reach it.
    await expect(
      resolvePdsRepoDidForDomain(database, {
        repo: handle,
        domain: 'other.example'
      })
    ).rejects.toBeInstanceOf(PdsRepoNotFoundError)

    const described = await describePdsRepo(database, { did })
    expect(described.handle).toBe(handle)
    expect(described.didDoc).toMatchObject({ alsoKnownAs: [`at://${handle}`] })
  })

  it('PdsReadOnlyRepoStorage does not retain a block cache across reads', async () => {
    const did = 'did:web:readonly-cache.pds.test'
    const payload = Buffer.from('hello-block-bytes')
    const cid = await cidForRawBytes(payload)

    await database.putPdsBlocks({
      did,
      blocks: [{ cid: cid.toString(), bytes: payload, repoRev: '3krev0000001' }]
    })

    const getBlocksSpy = vi.spyOn(database, 'getPdsBlocks')
    try {
      const storage = new PdsReadOnlyRepoStorage(database, did)

      const first = await storage.getBytes(cid)
      const second = await storage.getBytes(cid)
      expect(first).toEqual(payload)
      expect(second).toEqual(payload)
      expect(getBlocksSpy).toHaveBeenCalledTimes(2)

      const batch1 = await storage.getBlocks([cid])
      const batch2 = await storage.getBlocks([cid])
      expect(batch1.missing).toHaveLength(0)
      expect(batch2.missing).toHaveLength(0)
      expect(getBlocksSpy).toHaveBeenCalledTimes(4)
    } finally {
      getBlocksSpy.mockRestore()
    }
  })

  it('streams full and since CARs in bounded block/byte batches and verifies with verifyRepoCar for many records', async () => {
    const did = 'did:web:many-records.pds.test'
    const actorId = await createLocalActor('pds-many-records')
    const initial = await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // Create 120 records across 3 commits so the MST spans multiple nodes and
    // exceeds a single leaf batch (and include identical content to exercise
    // leaf deduplication).
    const totalRecords = 120
    const batchSize = 40
    let revAfterFirstBatch = initial.commit.rev
    let repoAtFirstBatch: Repo | null = null

    for (let batch = 0; batch < totalRecords / batchSize; batch += 1) {
      const writes = Array.from({ length: batchSize }, (_, i) => {
        const index = batch * batchSize + i
        return {
          action: 'create' as const,
          collection: 'app.bsky.feed.post',
          rkey: `3kmany${String(index).padStart(7, '0')}`,
          record: {
            $type: 'app.bsky.feed.post',
            text:
              index % 15 === 0
                ? 'duplicate-payload-for-dedup'
                : `Record #${index} ${'x'.repeat(256)}`,
            createdAt: '2026-11-24T12:00:00.000Z'
          }
        }
      })
      const committed = await applyPdsWrites(database, { did, writes })
      if (batch === 0) {
        revAfterFirstBatch = committed.commit.rev
        const firstCar = await getPdsRepoCar(database, { did })
        const parsedFirst = await readCarWithRoot(firstCar)
        repoAtFirstBatch = await Repo.load(
          new MemoryBlockstore(parsedFirst.blocks),
          parsedFirst.root
        )
      }
    }

    // Exercise small pageSize and small maxPageBytes to verify multi-batch
    // streaming for both full repo and `since` diff CARs.
    const getBlocksSpy = vi.spyOn(database, 'getPdsBlocks')
    const listBlocksSpy = vi.spyOn(database, 'listPdsBlocks')
    try {
      const fullCar = await getPdsRepoCar(database, {
        did,
        pageSize: 25,
        maxPageBytes: 4096
      })
      const verified = await verifyRepoCar(fullCar, did, fixedKey.did())
      expect(verified.creates).toHaveLength(totalRecords)

      // No single leaf fetch should have requested more than pageSize blocks.
      for (const [call] of getBlocksSpy.mock.calls) {
        expect(call.cids.length).toBeLessThanOrEqual(25)
      }
      expect(getBlocksSpy.mock.calls.length).toBeGreaterThan(5)

      const diffCar = await getPdsRepoCar(database, {
        did,
        since: revAfterFirstBatch,
        pageSize: 50,
        maxPageBytes: 4096
      })
      const verifiedDiff = await verifyDiffCar(
        repoAtFirstBatch!,
        diffCar,
        did,
        fixedKey.did()
      )
      expect(verifiedDiff.writes).toHaveLength(totalRecords - batchSize)
      // Byte bound forced multiple paginated listPdsBlocks calls even with pageSize=50.
      expect(listBlocksSpy.mock.calls.length).toBeGreaterThan(3)
      for (const [call] of listBlocksSpy.mock.calls) {
        expect(call.maxBytes).toBe(4096)
      }

      // Clamping: pageSize: 0 and maxPageBytes: 0 must not infinite-loop or
      // disable bounds on either full repo or since diff CARs.
      getBlocksSpy.mockClear()
      listBlocksSpy.mockClear()
      const clampedFullCar = await getPdsRepoCar(database, {
        did,
        pageSize: 0,
        maxPageBytes: 0
      })
      const verifiedClampedFull = await verifyRepoCar(
        clampedFullCar,
        did,
        fixedKey.did()
      )
      expect(verifiedClampedFull.creates).toHaveLength(totalRecords)
      for (const [call] of getBlocksSpy.mock.calls) {
        expect(call.cids.length).toBeLessThanOrEqual(1)
      }

      const clampedDiffCar = await getPdsRepoCar(database, {
        did,
        since: revAfterFirstBatch,
        pageSize: 0,
        maxPageBytes: 0
      })
      const verifiedClampedDiff = await verifyDiffCar(
        repoAtFirstBatch!,
        clampedDiffCar,
        did,
        fixedKey.did()
      )
      expect(verifiedClampedDiff.writes).toHaveLength(totalRecords - batchSize)
      for (const [call] of listBlocksSpy.mock.calls) {
        expect(call.limit).toBe(1)
        expect(call.maxBytes).toBe(1)
      }
    } finally {
      getBlocksSpy.mockRestore()
      listBlocksSpy.mockRestore()
    }
  })

  it('enforces account confirmation, approval, moderation, and deletion gates on createPdsRepo and resolveEffectivePdsRepoStatus', async () => {
    // 1. createPdsRepo refuses unconfirmed account even when allowlisted.
    const unconfirmedUsername = 'pds-gate-unconfirmed'
    await database.createAccount({
      email: `${unconfirmedUsername}@${TEST_DOMAIN}`,
      username: unconfirmedUsername,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      verificationCode: 'confirm-token-1',
      privateKey: `ap-priv-${unconfirmedUsername}`,
      publicKey: `ap-pub-${unconfirmedUsername}`
    })
    await expect(
      createPdsRepo(database, {
        did: 'did:web:gate-unconfirmed.pds.test',
        actorId: `https://${TEST_DOMAIN}/users/${unconfirmedUsername}`,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)

    // 2. createPdsRepo refuses unapproved account (approvedAt null).
    const unapprovedActorId = await createLocalActor('pds-gate-unapproved')
    const unapprovedActor = await database.getActorFromId({
      id: unapprovedActorId
    })
    await testDb.db
      .updateTable('accounts')
      .set({ approvedAt: null })
      .where('id', '=', unapprovedActor!.account!.id)
      .execute()
    await expect(
      createPdsRepo(database, {
        did: 'did:web:gate-unapproved.pds.test',
        actorId: unapprovedActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)

    // 3. createPdsRepo refuses suspended actor.
    const suspendedActorId = await createLocalActor('pds-gate-suspended')
    await database.setActorSuspended({
      actorId: suspendedActorId,
      suspended: true
    })
    await expect(
      createPdsRepo(database, {
        did: 'did:web:gate-suspended.pds.test',
        actorId: suspendedActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)

    // 4. createPdsRepo refuses disabled account.
    const disabledActorId = await createLocalActor('pds-gate-disabled')
    const disabledActor = await database.getActorFromId({ id: disabledActorId })
    await database.setAccountDisabled({
      accountId: disabledActor!.account!.id,
      disabled: true
    })
    await expect(
      createPdsRepo(database, {
        did: 'did:web:gate-disabled.pds.test',
        actorId: disabledActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)

    // 5. createPdsRepo refuses actor scheduled for deletion or deleting.
    const deletingActorId = await createLocalActor('pds-gate-deleting')
    await database.scheduleActorDeletion({
      actorId: deletingActorId,
      scheduledAt: new Date(Date.now() + 60_000)
    })
    await expect(
      createPdsRepo(database, {
        did: 'did:web:gate-deleting.pds.test',
        actorId: deletingActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)
    await database.startActorDeletion({ actorId: deletingActorId })
    await expect(
      createPdsRepo(database, {
        did: 'did:web:gate-deleting.pds.test',
        actorId: deletingActorId,
        domain: TEST_DOMAIN,
        signingKey: fixedKey
      })
    ).rejects.toBeInstanceOf(PdsNotAllowedError)

    // 6. resolveEffectivePdsRepoStatus & reads: missing actor -> deactivated.
    expect(resolveEffectivePdsRepoStatus({ status: 'active' }, null)).toBe(
      'deactivated'
    )
    const orphanDid = 'did:web:orphan-actor.pds.test'
    await database.createPdsRepo({
      did: orphanDid,
      actorId: `https://${TEST_DOMAIN}/users/nonexistent-orphan`,
      domain: TEST_DOMAIN,
      signingKey: 'v1:key',
      signingKeyDid: fixedKey.did(),
      rootCid: 'bafyorphan',
      rev: '3k00000000001'
    })
    expect(await getPdsRepoStatus(database, { did: orphanDid })).toEqual({
      did: orphanDid,
      active: false,
      status: 'deactivated'
    })
    await expect(
      getPdsLatestCommit(database, { did: orphanDid })
    ).rejects.toMatchObject({
      name: 'PdsRepoUnavailableError',
      code: 'RepoDeactivated'
    })

    // 7. Unapproved account -> deactivated on reads and listPdsRepos.
    const readUnapprovedDid = 'did:web:read-unapproved.pds.test'
    const readUnapprovedActorId = await createLocalActor('pds-read-unapproved')
    await createPdsRepo(database, {
      did: readUnapprovedDid,
      actorId: readUnapprovedActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const readUnapprovedActor = await database.getActorFromId({
      id: readUnapprovedActorId
    })
    await testDb.db
      .updateTable('accounts')
      .set({ approvedAt: null })
      .where('id', '=', readUnapprovedActor!.account!.id)
      .execute()
    expect(
      await getPdsRepoStatus(database, { did: readUnapprovedDid })
    ).toEqual({
      did: readUnapprovedDid,
      active: false,
      status: 'deactivated'
    })
    await expect(
      getPdsRepoCar(database, { did: readUnapprovedDid })
    ).rejects.toMatchObject({ code: 'RepoDeactivated' })

    // 8. Unconfirmed account (verificationCode set, emailVerified false) -> deactivated.
    const readUnconfirmedDid = 'did:web:read-unconfirmed.pds.test'
    const readUnconfirmedActorId = await createLocalActor(
      'pds-read-unconfirmed'
    )
    await createPdsRepo(database, {
      did: readUnconfirmedDid,
      actorId: readUnconfirmedActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const readUnconfirmedActor = await database.getActorFromId({
      id: readUnconfirmedActorId
    })
    await testDb.db
      .updateTable('accounts')
      .set({ verificationCode: 'pending-code', emailVerified: false })
      .where('id', '=', readUnconfirmedActor!.account!.id)
      .execute()
    expect(
      await getPdsRepoStatus(database, { did: readUnconfirmedDid })
    ).toEqual({
      did: readUnconfirmedDid,
      active: false,
      status: 'deactivated'
    })
    await expect(
      describePdsRepo(database, { did: readUnconfirmedDid })
    ).rejects.toMatchObject({ code: 'RepoDeactivated' })

    // 9. Account with emailVerified: true and legacy verificationCode stays active.
    const readConfirmedDid = 'did:web:read-confirmed-code.pds.test'
    const readConfirmedActorId = await createLocalActor(
      'pds-read-confirmed-code'
    )
    await createPdsRepo(database, {
      did: readConfirmedDid,
      actorId: readConfirmedActorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const readConfirmedActor = await database.getActorFromId({
      id: readConfirmedActorId
    })
    await testDb.db
      .updateTable('accounts')
      .set({ verificationCode: 'legacy-code', emailVerified: true })
      .where('id', '=', readConfirmedActor!.account!.id)
      .execute()
    expect(
      (await getPdsRepoStatus(database, { did: readConfirmedDid })).active
    ).toBe(true)

    const listed = await listPdsRepos(database, { domain: TEST_DOMAIN })
    const byDid = new Map(listed.repos.map((r) => [r.did, r]))
    expect(byDid.get(orphanDid)).toMatchObject({
      active: false,
      status: 'deactivated'
    })
    expect(byDid.get(readUnapprovedDid)).toMatchObject({
      active: false,
      status: 'deactivated'
    })
    expect(byDid.get(readUnconfirmedDid)).toMatchObject({
      active: false,
      status: 'deactivated'
    })
    expect(byDid.get(readConfirmedDid)).toMatchObject({ active: true })
  })

  it('bounds listPdsRecordValues by byte budget, fetches blocks in pages, and stops early with an accurate cursor', async () => {
    const did = 'did:web:list-budget.pds.test'
    const actorId = await createLocalActor('pds-list-budget')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const collection = 'app.bsky.feed.post'
    const expectedRkeys: string[] = []
    for (let i = 0; i < 6; i += 1) {
      const rkey = `3kbud${String(i).padStart(6, '0')}`
      expectedRkeys.push(rkey)
      await createPdsRecord(database, {
        did,
        collection,
        rkey,
        record: {
          $type: collection,
          text: `Budget post ${i} ${'z'.repeat(400)}`,
          createdAt: '2026-11-24T12:00:00.000Z'
        }
      })
    }

    const getBlocksSpy = vi.spyOn(database, 'getPdsBlocks')
    try {
      // Each CBOR record is ~460 bytes. With maxBytes=1000, at most 2 records
      // fit per page, forcing 3 pages across the 6 records (default desc order).
      const collectedDesc: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await listPdsRecordValues(database, {
          did,
          collection,
          cursor,
          limit: 100,
          maxBytes: 1000,
          blockPageSize: 1
        })
        expect(page.records.length).toBeGreaterThanOrEqual(1)
        expect(page.records.length).toBeLessThanOrEqual(2)
        collectedDesc.push(...page.records.map((r) => new AtUri(r.uri).rkey))
        cursor = page.cursor
        pages += 1
      } while (cursor)

      expect(pages).toBe(3)
      expect(collectedDesc).toEqual([...expectedRkeys].reverse())
      // blockPageSize=1 ensured every getPdsBlocks call fetched at most 1 CID.
      for (const [call] of getBlocksSpy.mock.calls) {
        expect(call.cids.length).toBeLessThanOrEqual(1)
      }

      // Same byte-budgeted walk works cleanly in reverse (ascending) order.
      const collectedAsc: string[] = []
      let ascCursor: string | undefined
      let ascPages = 0
      do {
        const page = await listPdsRecordValues(database, {
          did,
          collection,
          cursor: ascCursor,
          limit: 100,
          reverse: true,
          maxBytes: 1000,
          blockPageSize: 2
        })
        collectedAsc.push(...page.records.map((r) => new AtUri(r.uri).rkey))
        ascCursor = page.cursor
        ascPages += 1
      } while (ascCursor)
      expect(ascPages).toBe(3)
      expect(collectedAsc).toEqual(expectedRkeys)

      // A budget smaller than a single record still admits 1 record per page
      // so pagination always makes forward progress.
      const tinyPage = await listPdsRecordValues(database, {
        did,
        collection,
        limit: 100,
        maxBytes: 10
      })
      expect(tinyPage.records).toHaveLength(1)
      expect(tinyPage.cursor).toBe(new AtUri(tinyPage.records[0].uri).rkey)
    } finally {
      getBlocksSpy.mockRestore()
    }
  })

  it('streams getPdsBlocksCarStream in byte-bounded pages via getPdsBlockSizes and does not read block bytes until iterated', async () => {
    const did = 'did:web:blocks-pages.pds.test'
    const actorId = await createLocalActor('pds-blocks-pages')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const createdCids: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const rec = await createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        rkey: `3kblk${String(i).padStart(6, '0')}`,
        record: {
          $type: 'app.bsky.feed.post',
          text: `Block page ${i} ${'b'.repeat(400)}`,
          createdAt: '2026-11-24T12:00:00.000Z'
        }
      })
      createdCids.push(rec.cid)
    }

    const getSizesSpy = vi.spyOn(database, 'getPdsBlockSizes')
    const getBlocksSpy = vi.spyOn(database, 'getPdsBlocks')
    try {
      // Creating the stream validates existence via getPdsBlockSizes without
      // reading any block bytes until the stream is consumed (so HEAD reads no
      // block bytes).
      const stream = await getPdsBlocksCarStream(database, {
        did,
        cids: [...createdCids, createdCids[0]],
        maxPageBytes: 600
      })
      expect(getSizesSpy).toHaveBeenCalledTimes(1)
      expect(getBlocksSpy).not.toHaveBeenCalled()

      // Consuming the stream fetches blocks across multiple byte-bounded pages.
      const chunks: Uint8Array[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      // Each record CBOR block is ~460 bytes, so maxPageBytes=600 forces 1
      // block per page (4 getPdsBlocks calls instead of 1 unbounded fetch).
      expect(getBlocksSpy.mock.calls.length).toBe(4)
      for (const [call] of getBlocksSpy.mock.calls) {
        expect(call.cids).toHaveLength(1)
      }

      const car = await readCar(Buffer.concat(chunks))
      expect(car.roots).toEqual([])
      for (const cid of createdCids) {
        expect(car.blocks.has(parseCid(cid))).toBe(true)
      }
    } finally {
      getSizesSpy.mockRestore()
      getBlocksSpy.mockRestore()
    }
  })

  it('refuses all repo write paths with PdsDisabledError when PDS config is unset or the repo domain is disabled', async () => {
    const did = 'did:web:off-switch.pds.test'
    const actorId = await createLocalActor('pds-off-switch')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const existingRecord = {
      $type: 'app.bsky.feed.post',
      text: 'created while enabled',
      createdAt: '2026-11-24T12:00:00.000Z'
    }
    const created = await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      rkey: '3koff0001',
      record: existingRecord
    })

    for (const envValue of [
      undefined,
      JSON.stringify({
        [TEST_DOMAIN]: {
          enabled: false,
          hostname: `pds.${TEST_DOMAIN}`,
          allowEmails: [],
          allowActors: [`pds-off-switch@${TEST_DOMAIN}`]
        },
        'other-enabled.test': {
          enabled: true,
          hostname: 'pds.other-enabled.test',
          allowEmails: [],
          allowActors: []
        }
      })
    ]) {
      if (envValue === undefined) {
        delete process.env.ACTIVITIES_BLUESKY_PDS
      } else {
        process.env.ACTIVITIES_BLUESKY_PDS = envValue
      }

      await expect(
        applyPdsWrites(database, {
          did,
          writes: [
            {
              action: 'create',
              collection: 'app.bsky.feed.post',
              rkey: '3koff0002',
              record: {
                $type: 'app.bsky.feed.post',
                text: 'blocked',
                createdAt: '2026-11-24T12:01:00.000Z'
              }
            }
          ]
        })
      ).rejects.toBeInstanceOf(PdsDisabledError)

      await expect(
        createPdsRecord(database, {
          did,
          collection: 'app.bsky.feed.post',
          rkey: '3koff0003',
          record: {
            $type: 'app.bsky.feed.post',
            text: 'blocked create',
            createdAt: '2026-11-24T12:01:00.000Z'
          }
        })
      ).rejects.toBeInstanceOf(PdsDisabledError)

      // Both a changing put and a no-op put must refuse when disabled.
      await expect(
        putPdsRecord(database, {
          did,
          collection: 'app.bsky.feed.post',
          rkey: '3koff0001',
          record: existingRecord
        })
      ).rejects.toBeInstanceOf(PdsDisabledError)

      await expect(
        deletePdsRecord(database, {
          did,
          collection: 'app.bsky.feed.post',
          rkey: '3koff0001'
        })
      ).rejects.toBeInstanceOf(PdsDisabledError)
    }

    // Repo head and existing record remained untouched.
    const head = await getPdsLatestCommit(database, { did })
    expect(head.rev).toBe(created.commit.rev)
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3koff0001'
      })
    ).not.toBeNull()
  })
})

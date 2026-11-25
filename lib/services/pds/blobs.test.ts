import { Secp256k1Keypair } from '@atproto/crypto'
import { cidForRawBytes, cidForRawHash } from '@atproto/lex-data'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  FilePdsBlobObjectStore,
  MAX_PDS_BLOB_SIZE_BYTES,
  PDS_BLOB_REPO_LOCK_TTL_MS,
  PDS_BLOB_S3_REQUEST_TIMEOUT_MS,
  type PdsBlobObjectStore,
  PdsBlobTooLargeError,
  PdsDisabledError,
  PdsRepoUnavailableError,
  PdsStorageNotConfiguredError,
  PdsValidationError,
  S3PdsBlobObjectStore,
  assertPdsBlobKey,
  createPdsRecord,
  createPdsRepo,
  deletePdsRecord,
  getPdsBlobStorageKey,
  listPdsBlobCids,
  purgeActorPdsBlobs,
  putPdsRecord,
  readPdsBlob,
  uploadPdsBlob,
  withPdsRepoLock,
  xrpcBlobResponse
} from '@/lib/services/pds'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { logger } from '@/lib/utils/logger'

const FIXED_KEY_BYTES = Buffer.from(
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  'hex'
)

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

describe('PDS blob storage', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  let tempDir: string
  let fileStore: FilePdsBlobObjectStore
  let fixedKey: Secp256k1Keypair

  const allowedActorUsernames = [
    'pds-blobs',
    'pds-unavailable-blob',
    'pds-oversize',
    'pds-gc',
    'pds-mime',
    'pds-race',
    'pds-catch-keep',
    'pds-post-unavail',
    'pds-lock-ttl',
    'pds-disabled-upload',
    'pds-lock-race',
    'pds-late-delete',
    'pds-concurrent-upload',
    'pds-purge-lock',
    'pds-purge-nostore'
  ]

  const createAllowedLocalActor = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `ap-priv-${username}`,
      publicKey: `ap-pub-${username}`
    })
    return `https://${TEST_DOMAIN}/users/${username}`
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pds-blobs-test-'))
    fileStore = new FilePdsBlobObjectStore({
      type: MediaStorageType.LocalFile,
      path: tempDir
    })
    fixedKey = await Secp256k1Keypair.import(FIXED_KEY_BYTES, {
      exportable: true
    })
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: `pds.${TEST_DOMAIN}`,
        allowEmails: [],
        allowActors: allowedActorUsernames.map((u) => `${u}@${TEST_DOMAIN}`)
      }
    })
  })

  afterAll(async () => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    await fs.rm(tempDir, { recursive: true, force: true })
    await database.destroy()
  })

  it('round-trips blobs byte-for-byte with HMAC-derived storage keys and only serves referenced blobs', async () => {
    const did = 'did:web:blobs.pds.test'
    const actorId = await createAllowedLocalActor('pds-blobs')
    const createdRepo = await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // Include full byte range 0x00..0xFF and fake PNG magic with trailing non-PNG bytes
    // to prove the bytes are stored verbatim without any image re-encoding.
    const rawBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
      Buffer.from('trailing-arbitrary-metadata-bytes')
    ])

    const expectedCid = cidForRawHash(
      crypto.createHash('sha256').update(rawBytes).digest()
    )
    expect((await cidForRawBytes(rawBytes)).equals(expectedCid)).toBe(true)

    const uploaded = await uploadPdsBlob(
      database,
      {
        did,
        bytes: rawBytes,
        mimeType: 'IMAGE/PNG'
      },
      { store: fileStore }
    )

    expect(uploaded.cid).toBe(expectedCid.toString())
    expect(uploaded.size).toBe(rawBytes.byteLength)
    expect(uploaded.mimeType).toBe('image/png')
    // Storage key must use HMAC-SHA256 derived via secretBox HKDF, not bare
    // sha256(did), and carry a per-upload random suffix.
    expect(uploaded.storageKey).toMatch(
      new RegExp(
        `^pds-blobs/[a-f0-9]{64}/${expectedCid.toString()}\\.[a-f0-9]{16}$`
      )
    )
    expect(uploaded.storageKey).not.toBe(
      `pds-blobs/${crypto.createHash('sha256').update(did).digest('hex')}/${expectedCid.toString()}`
    )
    expect(
      getPdsBlobStorageKey(did, expectedCid.toString(), {
        secretPhase: 'secret-phase-1'
      })
    ).not.toBe(
      getPdsBlobStorageKey(did, expectedCid.toString(), {
        secretPhase: 'secret-phase-2'
      })
    )
    expect(uploaded.blob.$type).toBe('blob')
    expect(uploaded.blob.ref.equals(expectedCid)).toBe(true)
    expect(uploaded.blob.mimeType).toBe('image/png')
    expect(uploaded.blob.size).toBe(rawBytes.byteLength)

    // Uploading identical bytes again produces the exact same CID and reuses
    // the existing row (and its file) instead of writing a second one.
    const reuploaded = await uploadPdsBlob(
      database,
      {
        did,
        bytes: rawBytes,
        mimeType: 'image/png'
      },
      { store: fileStore }
    )
    expect(reuploaded.cid).toBe(uploaded.cid)
    expect(reuploaded.storageKey).toBe(uploaded.storageKey)

    // Uploaded-but-unreferenced blobs must NOT be served or listed.
    expect(
      await readPdsBlob(
        database,
        { did, cid: uploaded.cid },
        { store: fileStore }
      )
    ).toBeNull()
    expect(await listPdsBlobCids(database, { did })).toEqual({
      cids: [],
      cursor: undefined
    })

    // Link blob in a record: now both readPdsBlob and listPdsBlobCids return it.
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'with image',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'raw', image: uploaded.blob }]
        }
      }
    })

    const read = await readPdsBlob(
      database,
      { did, cid: uploaded.cid },
      { store: fileStore }
    )
    expect(read).not.toBeNull()
    expect(read!.mimeType).toBe('image/png')
    expect(read!.size).toBe(rawBytes.byteLength)
    const readBytes = await streamToBuffer(read!.stream)
    expect(readBytes.equals(rawBytes)).toBe(true)

    // Missing CID returns null.
    expect(
      await readPdsBlob(
        database,
        { did, cid: 'bafkreimissing' },
        { store: fileStore }
      )
    ).toBeNull()

    const allBlobs = await listPdsBlobCids(database, { did })
    expect(allBlobs.cids).toEqual([uploaded.cid])
    const sinceInit = await listPdsBlobCids(database, {
      did,
      since: createdRepo.commit.rev
    })
    expect(sinceInit.cids).toEqual([uploaded.cid])
  })

  it('deletes pds_blobs row and file when a commit removes the last reference, and logs file delete failures without failing the commit', async () => {
    const did = 'did:web:gc-blob.pds.test'
    const actorId = await createAllowedLocalActor('pds-gc')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const blob1 = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('shared-blob-bytes'), mimeType: 'image/png' },
      { store: fileStore }
    )
    const blob2 = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('single-ref-bytes'), mimeType: 'image/webp' },
      { store: fileStore }
    )

    // Link blob1 in two records, blob2 in one record.
    await createPdsRecord(
      database,
      {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3kgc0001',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'post 1',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [
              { alt: 'one', image: blob1.blob },
              { alt: 'two', image: blob2.blob }
            ]
          }
        }
      },
      { blobStore: fileStore }
    )
    await createPdsRecord(
      database,
      {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3kgc0002',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'post 2',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [{ alt: 'one-again', image: blob1.blob }]
          }
        }
      },
      { blobStore: fileStore }
    )

    // Updating post 1 to drop both blobs: blob2 loses its last ref and is deleted,
    // while blob1 stays alive because post 2 still references it.
    await putPdsRecord(
      database,
      {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3kgc0001',
        record: { $type: 'app.bsky.feed.post', text: 'post 1 no images' }
      },
      { blobStore: fileStore }
    )

    expect(
      await database.getPdsBlob({
        did,
        cid: blob2.cid,
        includeUnreferenced: true
      })
    ).toBeNull()
    expect(await fileStore.openRead(blob2.storageKey)).toBeNull()

    expect(
      await readPdsBlob(database, { did, cid: blob1.cid }, { store: fileStore })
    ).not.toBeNull()

    // Deleting post 2 removes the last reference to blob1. Simulate a failing
    // storage delete: commit must still succeed and log the error.
    const failingStore: PdsBlobObjectStore = {
      put: () => Promise.resolve(),
      openRead: (key) => fileStore.openRead(key),
      delete: vi.fn().mockRejectedValue(new Error('disk full'))
    }
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => {})
    try {
      const deleted = await deletePdsRecord(
        database,
        { did, collection: 'app.bsky.feed.post', rkey: '3kgc0002' },
        { blobStore: failingStore }
      )
      expect(deleted.deleted).toBe(true)
      expect(failingStore.delete).toHaveBeenCalledWith(blob1.storageKey)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          storageKey: blob1.storageKey,
          err: expect.any(Error)
        })
      )
    } finally {
      loggerErrorSpy.mockRestore()
    }
    expect(
      await database.getPdsBlob({
        did,
        cid: blob1.cid,
        includeUnreferenced: true
      })
    ).toBeNull()
  })

  it('validates mimeType strictly against type/subtype without parameters', async () => {
    const did = 'did:web:mime.pds.test'
    const actorId = await createAllowedLocalActor('pds-mime')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    for (const badMime of [
      '',
      '   ',
      'not-a-mime',
      'text/plain; charset=utf-8',
      'image/png; foo=bar',
      'image/png\r\nX-Injected: 1',
      'image/',
      '/png',
      'image/png/extra',
      'image/png with space',
      `application/${'a'.repeat(250)}`
    ]) {
      await expect(
        uploadPdsBlob(
          database,
          { did, bytes: Buffer.from('x'), mimeType: badMime },
          { store: fileStore }
        )
      ).rejects.toBeInstanceOf(PdsValidationError)
    }

    const svg = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('<svg/>'), mimeType: 'image/svg+xml' },
      { store: fileStore }
    )
    expect(svg.mimeType).toBe('image/svg+xml')
  })

  it('deletes only its own file when createPdsBlob loses a race, and returns the winning row', async () => {
    const did = 'did:web:race.pds.test'
    const actorId = await createAllowedLocalActor('pds-race')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const payload = Buffer.from('concurrent-upload-bytes')
    const cid = (await cidForRawBytes(payload)).toString()

    // Case 1: A concurrent upload committed the row (under its own unique key)
    // before our createPdsBlob threw. Our own file is an orphan and MUST be
    // deleted; the winner's row and file are returned.
    const winnerKey = getPdsBlobStorageKey(did, cid)
    const spyDelete = vi.spyOn(fileStore, 'delete')
    const racedDb = Object.create(database) as typeof database
    racedDb.createPdsBlob = vi.fn(async (params) => {
      // Simulate the concurrent winner writing its file and inserting its row
      // right before our call fails.
      await fileStore.put(winnerKey, payload)
      await database.createPdsBlob({ ...params, storageKey: winnerKey })
      throw new Error('simulated transient DB failure after winner committed')
    })

    const raced = await uploadPdsBlob(
      racedDb,
      { did, bytes: payload, mimeType: 'image/png' },
      { store: fileStore }
    )
    expect(raced.cid).toBe(cid)
    expect(raced.storageKey).toBe(winnerKey)
    expect(spyDelete).toHaveBeenCalledTimes(1)
    const [orphanKey] = spyDelete.mock.calls[0]
    expect(orphanKey).not.toBe(winnerKey)
    expect(await fileStore.openRead(orphanKey)).toBeNull()
    expect(await fileStore.openRead(winnerKey)).not.toBeNull()
    expect(await database.listPdsBlobStorageKeys({ did })).toEqual([winnerKey])
    spyDelete.mockRestore()

    // Case 2: No concurrent winner exists when createPdsBlob fails -> our file
    // IS cleaned up and the error propagates.
    const orphanPayload = Buffer.from('orphan-upload-bytes')
    const failingDb = Object.create(database) as typeof database
    failingDb.createPdsBlob = vi
      .fn()
      .mockRejectedValue(new Error('insert failed'))

    const deleteSpy = vi.spyOn(fileStore, 'delete')
    await expect(
      uploadPdsBlob(
        failingDb,
        { did, bytes: orphanPayload, mimeType: 'image/png' },
        { store: fileStore }
      )
    ).rejects.toThrow('insert failed')

    expect(deleteSpy).toHaveBeenCalledTimes(1)
    const [failedKey] = deleteSpy.mock.calls[0]
    expect(await fileStore.openRead(failedKey)).toBeNull()
    deleteSpy.mockRestore()
  })

  it('keeps our file when createPdsBlob threw after committing our row, or when checking the row throws', async () => {
    const did = 'did:web:catch-keep.pds.test'
    const actorId = await createAllowedLocalActor('pds-catch-keep')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // Case 1: createPdsBlob committed our row (with OUR storageKey), then threw
    // (e.g. connection dropped on the post-insert SELECT). We MUST keep our
    // file and return the persisted row.
    const ownPayload = Buffer.from('committed-then-threw-bytes')
    const ownCid = (await cidForRawBytes(ownPayload)).toString()
    const ownSpyDelete = vi.spyOn(fileStore, 'delete')
    const ownRowDb = Object.create(database) as typeof database
    ownRowDb.createPdsBlob = vi.fn(async (params) => {
      await database.createPdsBlob(params)
      throw new Error('post-insert select failed')
    })

    try {
      const result = await uploadPdsBlob(
        ownRowDb,
        { did, bytes: ownPayload, mimeType: 'image/png' },
        { store: fileStore }
      )
      expect(result.cid).toBe(ownCid)
      expect(ownSpyDelete).not.toHaveBeenCalled()
      const stored = await fileStore.openRead(result.storageKey)
      expect(stored).not.toBeNull()
      expect((await streamToBuffer(stored!)).equals(ownPayload)).toBe(true)
    } finally {
      ownSpyDelete.mockRestore()
    }

    // Case 2: createPdsBlob throws AND the recovery getPdsBlob check also
    // throws. Because we cannot confirm whether a row points to our file, we
    // MUST keep our file and rethrow the original error.
    const unknownPayload = Buffer.from('unknown-state-bytes')
    let writtenKey: string | null = null
    const trackingStore: PdsBlobObjectStore = {
      put: async (key, bytes) => {
        writtenKey = key
        await fileStore.put(key, bytes)
      },
      openRead: (key) => fileStore.openRead(key),
      delete: vi.fn((key) => fileStore.delete(key))
    }
    const failingCheckDb = Object.create(database) as typeof database
    let getBlobCalls = 0
    failingCheckDb.getPdsBlob = vi.fn(async (params) => {
      getBlobCalls += 1
      if (getBlobCalls === 1) {
        return database.getPdsBlob(params)
      }
      throw new Error('db check unreachable')
    })
    failingCheckDb.createPdsBlob = vi
      .fn()
      .mockRejectedValue(new Error('insert error'))

    await expect(
      uploadPdsBlob(
        failingCheckDb,
        { did, bytes: unknownPayload, mimeType: 'image/png' },
        { store: trackingStore }
      )
    ).rejects.toThrow('insert error')

    expect(trackingStore.delete).not.toHaveBeenCalled()
    expect(writtenKey).not.toBeNull()
    const keptStream = await fileStore.openRead(writtenKey!)
    expect(keptStream).not.toBeNull()
    expect((await streamToBuffer(keptStream!)).equals(unknownPayload)).toBe(
      true
    )
  })

  it('deletes the newly inserted row and file if the repo becomes unavailable before uploadPdsBlob finishes', async () => {
    const did = 'did:web:post-unavail.pds.test'
    const actorId = await createAllowedLocalActor('pds-post-unavail')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const payload = Buffer.from('uploaded-while-deleting-bytes')
    const cid = (await cidForRawBytes(payload)).toString()
    let writtenKey: string | null = null
    const trackingStore: PdsBlobObjectStore = {
      put: async (key, bytes) => {
        writtenKey = key
        await fileStore.put(key, bytes)
        // Simulate actor entering `deleting` while the blob upload was in flight.
        await database.startActorDeletion({ actorId })
      },
      openRead: (key) => fileStore.openRead(key),
      delete: (key) => fileStore.delete(key)
    }

    await expect(
      uploadPdsBlob(
        database,
        { did, bytes: payload, mimeType: 'image/png' },
        { store: trackingStore }
      )
    ).rejects.toBeInstanceOf(PdsRepoUnavailableError)

    expect(writtenKey).not.toBeNull()
    expect(await fileStore.openRead(writtenKey!)).toBeNull()
    expect(
      await database.getPdsBlob({ did, cid, includeUnreferenced: true })
    ).toBeNull()
  })

  it('uses a repo lock TTL longer than PDS_BLOB_S3_REQUEST_TIMEOUT_MS (+30s margin) for uploadPdsBlob and purgeActorPdsBlobs', async () => {
    const did = 'did:web:lock-ttl.pds.test'
    const actorId = await createAllowedLocalActor('pds-lock-ttl')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    expect(PDS_BLOB_REPO_LOCK_TTL_MS).toBe(
      PDS_BLOB_S3_REQUEST_TIMEOUT_MS + 30 * 1000
    )

    const acquireSpy = vi.spyOn(database, 'acquireImportLock')
    try {
      await uploadPdsBlob(
        database,
        { did, bytes: Buffer.from('ttl-check-bytes'), mimeType: 'image/png' },
        { store: fileStore }
      )
      expect(acquireSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ttlMs: PDS_BLOB_REPO_LOCK_TTL_MS })
      )

      acquireSpy.mockClear()
      await purgeActorPdsBlobs({ database, actorId, store: fileStore })
      expect(acquireSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ttlMs: PDS_BLOB_REPO_LOCK_TTL_MS })
      )
    } finally {
      acquireSpy.mockRestore()
    }
  })

  it('refuses uploadPdsBlob with PdsDisabledError when the repo domain is disabled or PDS config is unset', async () => {
    const did = 'did:web:disabled-upload.pds.test'
    const actorId = await createAllowedLocalActor('pds-disabled-upload')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const savedEnv = process.env.ACTIVITIES_BLUESKY_PDS
    const putSpy = vi.spyOn(fileStore, 'put')
    try {
      delete process.env.ACTIVITIES_BLUESKY_PDS
      await expect(
        uploadPdsBlob(
          database,
          {
            did,
            bytes: Buffer.from('off-switch-bytes'),
            mimeType: 'image/png'
          },
          { store: fileStore }
        )
      ).rejects.toBeInstanceOf(PdsDisabledError)

      process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
        [TEST_DOMAIN]: {
          enabled: false,
          hostname: `pds.${TEST_DOMAIN}`,
          allowEmails: [],
          allowActors: [`pds-disabled-upload@${TEST_DOMAIN}`]
        }
      })
      await expect(
        uploadPdsBlob(
          database,
          {
            did,
            bytes: Buffer.from('off-switch-bytes'),
            mimeType: 'image/png'
          },
          { store: fileStore }
        )
      ).rejects.toBeInstanceOf(PdsDisabledError)

      expect(putSpy).not.toHaveBeenCalled()
      expect(await database.listPdsBlobStorageKeys({ did })).toEqual([])
    } finally {
      putSpy.mockRestore()
      if (savedEnv === undefined) {
        delete process.env.ACTIVITIES_BLUESKY_PDS
      } else {
        process.env.ACTIVITIES_BLUESKY_PDS = savedEnv
      }
    }
  })

  it('keeps a re-uploaded blob when the previous upload file delete runs late', async () => {
    const did = 'did:web:late-delete.pds.test'
    const actorId = await createAllowedLocalActor('pds-late-delete')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const payload = Buffer.from('late-delete-race-bytes')
    const first = await uploadPdsBlob(
      database,
      { did, bytes: payload, mimeType: 'image/png' },
      { store: fileStore }
    )
    await createPdsRecord(
      database,
      {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3klatedel01',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'holds blob',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [{ alt: 'late', image: first.blob }]
          }
        }
      },
      { blobStore: fileStore }
    )

    // Defer the file delete: capture the key the commit removed, delete nothing
    // yet. This is the slow S3 delete that outlives the repo lock.
    const deferredKeys: string[] = []
    const deferringStore: PdsBlobObjectStore = {
      put: (key, bytes) => fileStore.put(key, bytes),
      openRead: (key) => fileStore.openRead(key),
      delete: async (key) => {
        deferredKeys.push(key)
      }
    }

    const deleted = await deletePdsRecord(
      database,
      { did, collection: 'app.bsky.feed.post', rkey: '3klatedel01' },
      { blobStore: deferringStore }
    )
    expect(deleted.deleted).toBe(true)
    expect(deferredKeys).toEqual([first.storageKey])
    expect(
      await database.getPdsBlob({
        did,
        cid: first.cid,
        includeUnreferenced: true
      })
    ).toBeNull()

    // Re-upload the same bytes: a new unique key, so the deferred delete of the
    // old key cannot touch it.
    const second = await uploadPdsBlob(
      database,
      { did, bytes: payload, mimeType: 'image/png' },
      { store: fileStore }
    )
    expect(second.cid).toBe(first.cid)
    expect(second.storageKey).not.toBe(first.storageKey)

    // The late delete of the old key runs now.
    await fileStore.delete(deferredKeys[0])

    // The new file survives and is served once a record references it.
    await createPdsRecord(
      database,
      {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3klatedel02',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'holds re-uploaded blob',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [{ alt: 'late', image: second.blob }]
          }
        }
      },
      { blobStore: fileStore }
    )
    const read = await readPdsBlob(
      database,
      { did, cid: second.cid },
      { store: fileStore }
    )
    expect(read).not.toBeNull()
    expect((await streamToBuffer(read!.stream)).equals(payload)).toBe(true)
  })

  it('leaves one row and one file when two uploads of the same bytes race', async () => {
    const did = 'did:web:concurrent-upload.pds.test'
    const actorId = await createAllowedLocalActor('pds-concurrent-upload')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const payload = Buffer.from('concurrent-identical-bytes')
    const [a, b] = await Promise.all([
      uploadPdsBlob(
        database,
        { did, bytes: payload, mimeType: 'image/png' },
        { store: fileStore }
      ),
      uploadPdsBlob(
        database,
        { did, bytes: payload, mimeType: 'image/png' },
        { store: fileStore }
      )
    ])

    expect(a.cid).toBe(b.cid)
    expect(a.storageKey).toBe(b.storageKey)
    expect(await database.listPdsBlobStorageKeys({ did })).toEqual([
      a.storageKey
    ])

    const directory = path.join(tempDir, path.dirname(a.storageKey))
    expect(await fs.readdir(directory)).toEqual([path.basename(a.storageKey)])
  })

  it('serializes uploadPdsBlob under withPdsRepoLock so a re-upload cannot interleave with post-commit blob deletion', async () => {
    const did = 'did:web:lock-race.pds.test'
    const actorId = await createAllowedLocalActor('pds-lock-race')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const payload = Buffer.from('reupload-vs-delete-race-bytes')
    const uploaded = await uploadPdsBlob(
      database,
      { did, bytes: payload, mimeType: 'image/png' },
      { store: fileStore }
    )
    await createPdsRecord(
      database,
      {
        did,
        collection: 'app.bsky.feed.post',
        rkey: '3klockrace01',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'holds blob',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [{ alt: 'race', image: uploaded.blob }]
          }
        }
      },
      { blobStore: fileStore }
    )

    const order: string[] = []
    let notifyDeleteStarted!: () => void
    const deleteStarted = new Promise<void>((resolve) => {
      notifyDeleteStarted = resolve
    })
    let allowDeleteFinish!: () => void
    const canDeleteFinish = new Promise<void>((resolve) => {
      allowDeleteFinish = resolve
    })

    const pausedDeleteStore: PdsBlobObjectStore = {
      put: (key, bytes) => fileStore.put(key, bytes),
      openRead: (key) => fileStore.openRead(key),
      delete: async (key) => {
        order.push('delete:start')
        notifyDeleteStarted()
        await canDeleteFinish
        await fileStore.delete(key)
        order.push('delete:end')
      }
    }

    const trackingUploadStore: PdsBlobObjectStore = {
      put: async (key, bytes) => {
        order.push('put:start')
        await fileStore.put(key, bytes)
        order.push('put:end')
      },
      openRead: (key) => fileStore.openRead(key),
      delete: (key) => fileStore.delete(key)
    }

    // Start record deletion; it commits the DB delete and pauses while holding
    // withPdsRepoLock during post-commit blob file removal.
    const deletePromise = deletePdsRecord(
      database,
      { did, collection: 'app.bsky.feed.post', rkey: '3klockrace01' },
      { blobStore: pausedDeleteStore }
    )
    await deleteStarted

    // Concurrent re-upload of the exact same bytes MUST wait for the repo lock
    // instead of writing the file while the post-commit delete is in progress.
    const reuploadPromise = uploadPdsBlob(
      database,
      { did, bytes: payload, mimeType: 'image/png' },
      { store: trackingUploadStore }
    )
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(order).toEqual(['delete:start'])

    allowDeleteFinish()
    const [deleteResult, reuploadResult] = await Promise.all([
      deletePromise,
      reuploadPromise
    ])

    expect(deleteResult.deleted).toBe(true)
    expect(reuploadResult.cid).toBe(uploaded.cid)
    expect(reuploadResult.storageKey).not.toBe(uploaded.storageKey)
    expect(order).toEqual([
      'delete:start',
      'delete:end',
      'put:start',
      'put:end'
    ])

    // Because upload ran strictly after delete, the re-uploaded file and DB row
    // both survive; the deleted upload's file is gone.
    expect(await fileStore.openRead(uploaded.storageKey)).toBeNull()
    const storedStream = await fileStore.openRead(reuploadResult.storageKey)
    expect(storedStream).not.toBeNull()
    expect((await streamToBuffer(storedStream!)).equals(payload)).toBe(true)
    expect(
      await database.getPdsBlob({
        did,
        cid: uploaded.cid,
        includeUnreferenced: true
      })
    ).not.toBeNull()
  })

  it('serializes purgeActorPdsBlobs under withPdsRepoLock while listing and deleting blobs', async () => {
    const did = 'did:web:purge-lock.pds.test'
    const actorId = await createAllowedLocalActor('pds-purge-lock')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const uploaded = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('purge-lock-bytes'), mimeType: 'image/png' },
      { store: fileStore }
    )

    const order: string[] = []
    let notifyLockHeld!: () => void
    const lockHeld = new Promise<void>((resolve) => {
      notifyLockHeld = resolve
    })
    let releaseLock!: () => void
    const canReleaseLock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })

    const realListKeys = database.listPdsBlobStorageKeys.bind(database)
    const trackedListSpy = vi
      .spyOn(database, 'listPdsBlobStorageKeys')
      .mockImplementation(async (params) => {
        order.push('purge:list')
        return realListKeys(params)
      })
    const trackedStore: PdsBlobObjectStore = {
      put: (key, bytes) => fileStore.put(key, bytes),
      openRead: (key) => fileStore.openRead(key),
      delete: async (key) => {
        order.push('purge:delete')
        await fileStore.delete(key)
      }
    }

    try {
      const holderPromise = withPdsRepoLock(database, did, async () => {
        order.push('holder:start')
        notifyLockHeld()
        await canReleaseLock
        order.push('holder:end')
      })
      await lockHeld

      const purgePromise = purgeActorPdsBlobs({
        database,
        actorId,
        store: trackedStore
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(order).toEqual(['holder:start'])

      releaseLock()
      await Promise.all([holderPromise, purgePromise])

      expect(order).toEqual([
        'holder:start',
        'holder:end',
        'purge:list',
        'purge:delete'
      ])
      expect(await fileStore.openRead(uploaded.storageKey)).toBeNull()
    } finally {
      trackedListSpy.mockRestore()
    }
  })

  it('throws from purgeActorPdsBlobs when blobs exist but no store is configured, so rows are kept for a retry', async () => {
    const did = 'did:web:purge-nostore.pds.test'
    const actorId = await createAllowedLocalActor('pds-purge-nostore')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    // No blobs yet: nothing to remove, so a missing store is fine.
    await expect(
      purgeActorPdsBlobs({ database, actorId, store: null })
    ).resolves.toBeUndefined()

    await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('purge-nostore'), mimeType: 'image/png' },
      { store: fileStore }
    )
    await expect(
      purgeActorPdsBlobs({ database, actorId, store: null })
    ).rejects.toBeInstanceOf(PdsStorageNotConfiguredError)
    expect(await database.listPdsBlobStorageKeys({ did })).toHaveLength(1)
  })

  it('refuses a deactivated or taken-down repo blob like the other sync reads', async () => {
    const did = 'did:web:unavailable-blob.pds.test'
    const actorId = await createAllowedLocalActor('pds-unavailable-blob')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })
    const uploaded = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('still-stored'), mimeType: 'text/plain' },
      { store: fileStore }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'linked blob',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'a', image: uploaded.blob }]
        }
      }
    })

    for (const status of ['deactivated', 'takendown'] as const) {
      await database.updatePdsRepoStatus({ did, status })

      await expect(
        readPdsBlob(database, { did, cid: uploaded.cid }, { store: fileStore })
      ).rejects.toBeInstanceOf(PdsRepoUnavailableError)
    }
  })

  it('refuses blobs larger than 50 MiB without writing to storage or DB', async () => {
    const did = 'did:web:oversize.pds.test'
    const actorId = await createAllowedLocalActor('pds-oversize')
    await createPdsRepo(database, {
      did,
      actorId,
      domain: TEST_DOMAIN,
      signingKey: fixedKey
    })

    const tooLarge = Buffer.alloc(MAX_PDS_BLOB_SIZE_BYTES + 1)
    await expect(
      uploadPdsBlob(
        database,
        {
          did,
          bytes: tooLarge,
          mimeType: 'application/octet-stream'
        },
        { store: fileStore }
      )
    ).rejects.toBeInstanceOf(PdsBlobTooLargeError)

    expect(await listPdsBlobCids(database, { did })).toEqual({
      cids: [],
      cursor: undefined
    })
  })

  it('rejects invalid or traversing PDS blob storage keys', () => {
    const did = 'did:web:keycheck.pds.test'
    const validKey = getPdsBlobStorageKey(did, 'bafkrei1234567890abc')
    expect(assertPdsBlobKey(validKey)).toBe(validKey)
    expect(validKey).toMatch(
      /^pds-blobs\/[a-f0-9]{64}\/bafkrei1234567890abc\.[a-f0-9]{16}$/
    )

    const hmac = 'a'.repeat(64)
    for (const badKey of [
      'medias/2026/file.png',
      'pds-blobs/../etc/passwd',
      'pds-blobs/not-a-sha256/bafkrei123',
      'pds-blobs/' + hmac + '/bad/nested',
      '../pds-blobs/' + hmac + '/bafkrei123',
      // The old deterministic shape (no random suffix) is no longer accepted.
      'pds-blobs/' + hmac + '/bafkrei123',
      // Suffix must be exactly 16 lowercase hex characters.
      'pds-blobs/' + hmac + '/bafkrei123.' + 'a'.repeat(15),
      'pds-blobs/' + hmac + '/bafkrei123.' + 'a'.repeat(17),
      'pds-blobs/' + hmac + '/bafkrei123.' + 'g'.repeat(16),
      'pds-blobs/' + hmac + '/bafkrei123.' + 'A'.repeat(16),
      // Traversal in the CID segment.
      'pds-blobs/' + hmac + '/../bafkrei123.' + 'a'.repeat(16),
      'pds-blobs/' + hmac + '/bafkrei123..' + 'a'.repeat(16)
    ]) {
      expect(() => assertPdsBlobKey(badKey)).toThrow(PdsValidationError)
    }
  })

  it('supports S3PdsBlobObjectStore raw put, stream read, 404 null, and delete', async () => {
    const sent: unknown[] = []
    const payload = Buffer.from([1, 2, 3, 4, 5])
    const mockClient = {
      send: vi.fn(async (command: unknown) => {
        sent.push(command)
        if (command instanceof GetObjectCommand) {
          if (command.input.Key?.includes('missingcid')) {
            const err = new Error('NoSuchKey')
            err.name = 'NoSuchKey'
            throw err
          }
          return { Body: Readable.from([payload]) }
        }
        return {}
      })
    } as unknown as S3Client

    const s3Store = new S3PdsBlobObjectStore(
      {
        type: MediaStorageType.S3Storage,
        bucket: 'test-bucket',
        region: 'us-east-1'
      },
      mockClient
    )

    const key = getPdsBlobStorageKey('did:web:s3.pds.test', 'bafkreiabc123')
    await s3Store.put(key, payload, 'image/webp')
    expect(sent[0]).toBeInstanceOf(PutObjectCommand)
    expect((sent[0] as PutObjectCommand).input).toMatchObject({
      Bucket: 'test-bucket',
      Key: key,
      Body: payload,
      ContentType: 'image/webp'
    })
    expect(
      (sent[0] as PutObjectCommand).input.ContentDisposition
    ).toBeUndefined()

    // Non-inline types (SVG, HTML, PDF) must be stored as application/octet-stream
    // with ContentDisposition: attachment, and parameterized safe raster types
    // must be canonicalized to their bare base type without ContentDisposition.
    await s3Store.put(key, payload, 'image/svg+xml')
    expect((sent[1] as PutObjectCommand).input).toMatchObject({
      ContentType: 'application/octet-stream',
      ContentDisposition: 'attachment'
    })

    await s3Store.put(key, payload, 'text/html')
    expect((sent[2] as PutObjectCommand).input).toMatchObject({
      ContentType: 'application/octet-stream',
      ContentDisposition: 'attachment'
    })

    await s3Store.put(key, payload, 'IMAGE/PNG; charset=utf-8')
    expect((sent[3] as PutObjectCommand).input).toMatchObject({
      ContentType: 'image/png'
    })
    expect(
      (sent[3] as PutObjectCommand).input.ContentDisposition
    ).toBeUndefined()

    const stream = await s3Store.openRead(key)
    expect(stream).not.toBeNull()
    expect((await streamToBuffer(stream!)).equals(payload)).toBe(true)

    const missingKey = getPdsBlobStorageKey('did:web:s3.pds.test', 'missingcid')
    expect(await s3Store.openRead(missingKey)).toBeNull()

    await s3Store.delete(key)
    expect(sent[sent.length - 1]).toBeInstanceOf(DeleteObjectCommand)
  })

  it('canonicalizes blob response Content-Type and destroys the stream if building the response throws', () => {
    const inlineStream = Readable.from([Buffer.from('png-bytes')])
    const inlineRes = xrpcBlobResponse({
      stream: inlineStream,
      mimeType: 'IMAGE/JPEG; foo=bar',
      size: 9
    })
    expect(inlineRes.headers.get('Content-Type')).toBe('image/jpeg')
    expect(inlineRes.headers.get('Content-Disposition')).toBeNull()
    expect(inlineRes.headers.get('Cache-Control')).toBe('no-store')
    inlineStream.destroy()

    const svgStream = Readable.from([Buffer.from('<svg/>')])
    const svgRes = xrpcBlobResponse({
      stream: svgStream,
      mimeType: 'image/svg+xml',
      size: 6
    })
    expect(svgRes.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(svgRes.headers.get('Content-Disposition')).toBe('attachment')
    svgStream.destroy()

    const failingStream = Readable.from([Buffer.from('data')])
    const toWebSpy = vi.spyOn(Readable, 'toWeb').mockImplementationOnce(() => {
      throw new Error('simulated toWeb failure')
    })
    try {
      expect(() =>
        xrpcBlobResponse({
          stream: failingStream,
          mimeType: 'image/png',
          size: 4
        })
      ).toThrow('simulated toWeb failure')
      expect(failingStream.destroyed).toBe(true)
    } finally {
      toWebSpy.mockRestore()
    }
  })
})

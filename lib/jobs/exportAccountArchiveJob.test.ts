import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getArchiveMediaPath } from '@/lib/services/accountArchive/actorArchive'
import {
  FileArchiveObjectStore,
  getArchiveObjectStore
} from '@/lib/services/accountArchive/objectStore'
import {
  parseProgress,
  serializeProgress
} from '@/lib/services/accountArchive/progress'
import { requestAccountArchive } from '@/lib/services/accountArchive/request'
import {
  collectKeys,
  readZip,
  readZipStreaming,
  verifyZipWithTools
} from '@/lib/services/accountArchive/testing/readZip'
import { sendMail } from '@/lib/services/email'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { exportAccountArchiveJob } from './exportAccountArchiveJob'

// One page per slice: every slice runs out of time after its first page, so the
// export has to resume from its persisted cursor many times.
vi.mock('@/lib/services/accountArchive/constants', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/services/accountArchive/constants')
  >()),
  ARCHIVE_PAGE_SIZE: 2
}))
const sliceBudget = vi.hoisted(() => ({ ms: 0 }))
vi.mock('@/lib/services/accountArchive/budget', () => ({
  getArchiveSliceBudgetMs: () => sliceBudget.ms
}))

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))
vi.mock('@/lib/services/email', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined)
}))

// `publicKey` is not here on purpose: actor.json carries the actor's public key
// like every ActivityPub actor document, and Mastodon's own export does too.
const FORBIDDEN_KEYS = [
  'privateKey',
  'privateKeyPem',
  'passwordHash',
  'password',
  'clientSecret',
  'accessToken',
  'refreshToken',
  'token',
  'secret',
  'endpoint',
  'p256dh',
  'auth',
  'webhookToken',
  'wahooWebhookToken',
  'oauthState',
  'verificationCode',
  'passwordResetCode',
  'emailChangeCode',
  'twoFactorSecret',
  'totpSecret'
]

describe('exportAccountArchiveJob', () => {
  const { database, db, prepare, destroy } = createTestDatabase()
  const published: { id: string; name: string; data: unknown }[] = []
  const seenIds = new Set<string>()
  let root: string
  let accountId: string
  let secondAccountId: string

  const baseConfig = () => vi.mocked(getConfig)()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromEmail({ email: seedActor1.email }))!
      .account!.id
    secondAccountId = (await database.getActorFromEmail({
      email: seedActor2.email
    }))!.account!.id
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    sliceBudget.ms = 0
    await db.deleteFrom('account_archives').execute()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-archive-'))
    vi.mocked(getConfig).mockReturnValue({
      ...baseConfig(),
      mediaStorage: { type: MediaStorageType.LocalFile, path: root }
    } as ReturnType<typeof getConfig>)
    published.length = 0
    seenIds.clear()
    vi.mocked(sendMail).mockClear()
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      // Like the real queues, keep one copy of a message id.
      publish: vi.fn(async (message) => {
        if (seenIds.has(message.id)) return
        seenIds.add(message.id)
        published.push(message)
      }),
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  const makeArchive = async (
    forAccount: string,
    options: { stripExactLocations?: boolean; drafts?: boolean } = {}
  ) => {
    const id = crypto.randomUUID()
    await database.createAccountArchive({
      id,
      accountId: forAccount,
      options: {
        stripExactLocations: options.stripExactLocations ?? false,
        drafts: options.drafts ?? false
      }
    })
    return id
  }

  const run = (archiveId: string, slice = 0, action?: 'expire') =>
    exportAccountArchiveJob(database, {
      id: `test-${archiveId}-${slice}`,
      name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { archiveId, slice, action }
    })

  /** Delivers each published continuation, as the queue would. */
  const runToCompletion = async (archiveId: string, maxSlices = 400) => {
    await run(archiveId, 0)
    for (let slices = 0; slices < maxSlices; slices += 1) {
      const next = published.find(
        (message) =>
          (message.data as { archiveId: string; action?: string }).archiveId ===
            archiveId &&
          (message.data as { action?: string }).action === undefined
      )
      if (!next) break
      published.splice(published.indexOf(next), 1)
      await run(archiveId, (next.data as { slice: number }).slice)
    }
    return (await database.getAccountArchive({ id: archiveId }))!
  }

  const readArchive = async (archiveId: string) => {
    const archive = (await database.getAccountArchive({ id: archiveId }))!
    expect(archive.storagePath).toBeTruthy()
    const file = path.join(root, archive.storagePath!)
    // Whatever slices wrote it, unzip and Python must accept it as a whole.
    expect(verifyZipWithTools(file).length).toBeGreaterThan(0)
    return readZip(file)
  }

  const archiveDir = async (archiveId: string) => {
    const archive = (await database.getAccountArchive({ id: archiveId }))!
    return path.join(root, 'archives', archiveId, archive.storageToken)
  }

  it('builds a Mastodon-shaped archive across many resumed slices', async () => {
    const id = await makeArchive(accountId)
    const archive = await runToCompletion(id)

    expect(archive.status).toBe('ready')
    expect(archive.progress).toBeNull()
    expect(archive.bytes).toBeGreaterThan(0)
    expect(archive.expiresAt! - archive.readyAt!).toBe(7 * 24 * 60 * 60 * 1000)

    const { names, files } = await readArchive(id)
    for (const name of [
      'actor.json',
      'outbox.json',
      'likes.json',
      'bookmarks.json',
      'activities.next/manifest.json',
      'activities.next/account.json',
      'activities.next/actors/llun.test/test1/profile.json',
      'activities.next/actors/llun.test/test1/statuses.jsonl',
      'activities.next/actors/llun.test/test1/medias.jsonl',
      'activities.next/actors/llun.test/test1/scheduled.json',
      'activities.next/actors/llun.test/test1/graph.json',
      'activities.next/actors/llun.test/test1/gallery/albums.json',
      'activities.next/actors/llun.test/test1/gallery/gears.json',
      'activities.next/actors/llun.test/test1/gallery/settings.json',
      'activities.next/actors/llun.test/test1/fitness/files.jsonl',
      'activities.next/actors/llun.test/test1/fitness/gears.json',
      'activities.next/actors/llun.test/test1/fitness/settings.json'
    ]) {
      expect(names, name).toContain(name)
    }
    // No duplicate entries, and the manifest closes the archive.
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length
    )
    expect(names[names.length - 1]).toBe('activities.next/manifest.json')
    expect(names).not.toContain('manifest.json')

    const actor = JSON.parse(files.get('actor.json')!.toString())
    expect(actor.type).toBe('Person')
    expect(actor.preferredUsername).toBe('test1')
    // The collections are the sibling files, as in a Mastodon backup.
    expect(actor.outbox).toBe('outbox.json')
    expect(actor.likes).toBe('likes.json')
    expect(actor.bookmarks).toBe('bookmarks.json')

    const outbox = JSON.parse(files.get('outbox.json')!.toString())
    expect(outbox.type).toBe('OrderedCollection')
    expect(outbox.orderedItems.length).toBe(outbox.totalItems)
    expect(outbox.totalItems).toBeGreaterThan(2)
    for (const activity of outbox.orderedItems) {
      expect(['Create', 'Announce']).toContain(activity.type)
    }

    const statuses = files
      .get('activities.next/actors/llun.test/test1/statuses.jsonl')!
      .toString()
      .trim()
      .split('\n')
    expect(statuses.length).toBe(outbox.totalItems)
    for (const line of statuses) JSON.parse(line)

    const manifest = JSON.parse(
      files.get('activities.next/manifest.json')!.toString()
    )
    expect(manifest.format).toBe('activities.next-archive')
    expect(new Date(manifest.exportedAt).getTime()).toBeGreaterThan(0)
    expect(manifest.server).toBe(getConfig().host)
    expect(manifest.account).toEqual({
      id: accountId,
      signUpDomain: expect.any(String),
      defaultActorId: (await database.getAccountExportAccount({ accountId }))
        ?.defaultActorId
    })
    expect(manifest.entries).toContain('outbox.json')
    expect(manifest.actors[0]).toMatchObject({
      id: ACTOR1_ID,
      handle: '@test1@llun.test',
      username: 'test1',
      isDefault: true,
      directory: 'activities.next/actors/llun.test/test1'
    })
    expect(manifest.actors[0].counts.statuses).toBe(outbox.totalItems)
  })

  it('never writes a secret key name or value into any entry', async () => {
    const id = await makeArchive(accountId)
    await runToCompletion(id)
    const { names, files } = await readArchive(id)

    const jsonNames = names.filter((name) => /\.(json|jsonl)$/.test(name))
    expect(jsonNames.length).toBeGreaterThan(8)
    for (const name of jsonNames) {
      const text = files.get(name)!.toString()
      const documents = name.endsWith('.jsonl')
        ? text
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [JSON.parse(text)]
      const keys = collectKeys(documents)
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys.has(forbidden), `${forbidden} in ${name}`).toBe(false)
      }
      expect(text).not.toContain('PRIVATE KEY')
      expect(text).not.toContain(seedActor1.passwordHash)
    }
  })

  it('lays other profiles out under activities.next/actors', async () => {
    const extraId = await database.createActorForAccount({
      accountId: secondAccountId,
      username: 'second',
      domain: 'llun.test',
      publicKey: 'public',
      privateKey: 'private'
    })
    expect(extraId).toBeTruthy()

    const id = await makeArchive(secondAccountId)
    await runToCompletion(id)
    const { names, files } = await readArchive(id)

    // The default profile is the Mastodon root; the other one is in its own folder.
    expect(names).toContain('actor.json')
    const root = JSON.parse(files.get('actor.json')!.toString())
    expect(root.preferredUsername).toBe(seedActor2.username)
    const other = 'activities.next/actors/llun.test/second'
    expect(names).toContain(`${other}/actor.json`)
    expect(names).toContain(`${other}/outbox.json`)
    expect(names).toContain(`${other}/profile.json`)
    expect(
      JSON.parse(files.get(`${other}/actor.json`)!.toString()).preferredUsername
    ).toBe('second')
    const manifest = JSON.parse(
      files.get('activities.next/manifest.json')!.toString()
    )
    expect(
      manifest.actors.map((entry: { username: string }) => entry.username)
    ).toEqual([seedActor2.username, 'second'])
  })

  describe('medias', () => {
    const mediaPath = 'medias/2026-01-01/export-test.jpg'

    beforeAll(async () => {
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: mediaPath,
          bytes: 5,
          mimeType: 'image/jpeg',
          metaData: { width: 1, height: 1 }
        }
      })
      await db
        .updateTable('medias')
        .set({ placeLatitude: 13.7563, placeLongitude: 100.5018 })
        .where('id', '=', Number(media!.id))
        .execute()
    })

    const writeMediaFile = async () => {
      const target = path.join(root, mediaPath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, 'IMAGE')
    }

    it('copies stored files under the Mastodon media folder and keeps place coordinates', async () => {
      await writeMediaFile()
      const id = await makeArchive(accountId)
      await runToCompletion(id)
      const { files } = await readArchive(id)

      expect(files.get(getArchiveMediaPath(mediaPath))?.toString()).toBe(
        'IMAGE'
      )
      const lines = files
        .get('activities.next/actors/llun.test/test1/medias.jsonl')!
        .toString()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const line = lines.find((entry) => entry.original === mediaPath)
      expect(line.archivePath).toBe(getArchiveMediaPath(mediaPath))
      expect(line.placeLatitude).toBeCloseTo(13.7563)
      expect(line.placeLongitude).toBeCloseTo(100.5018)
    })

    it('drops exact coordinates with stripExactLocations', async () => {
      await writeMediaFile()
      const id = await makeArchive(accountId, { stripExactLocations: true })
      await runToCompletion(id)
      const { files } = await readArchive(id)
      const text = files
        .get('activities.next/actors/llun.test/test1/medias.jsonl')!
        .toString()
      expect(text).toContain(mediaPath)
      expect(text).not.toContain('placeLatitude')
      expect(text).not.toContain('placeLongitude')
      expect(text).not.toContain('13.7563')
    })

    it('leaves a missing file out with a warning instead of failing', async () => {
      const id = await makeArchive(accountId)
      const archive = await runToCompletion(id)
      expect(archive.status).toBe('ready')
      const { names, files } = await readArchive(id)
      expect(names).not.toContain(getArchiveMediaPath(mediaPath))
      const manifest = JSON.parse(
        files.get('activities.next/manifest.json')!.toString()
      )
      expect(manifest.files.skipped).toBeGreaterThan(0)
      const warning = manifest.warnings.join('\n')
      expect(warning).toContain('missing from storage')
      // The storage root never reaches the archive the user downloads.
      expect(warning).not.toContain(root)
    })
  })

  it('stores the drafts the request carried as activities.next/drafts.json', async () => {
    const result = await requestAccountArchive({
      database,
      accountId: secondAccountId,
      options: {},
      drafts: [
        {
          id: 'draft-1',
          composer: 'post-box',
          text: 'hello draft',
          attachments: [
            {
              localId: 'a',
              mediaType: 'image',
              fileName: 'a.png',
              description: 'alt',
              hasBlob: true,
              bytes: 'AAAA'
            }
          ],
          submit: { key: 'idempotency-key', fingerprint: 'x' }
        }
      ]
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive.options.drafts).toBe(true)

    const message = published.find(
      (entry) =>
        (entry.data as { archiveId: string }).archiveId === result.archive.id
    )
    expect(message).toBeDefined()
    const archive = await runToCompletion(result.archive.id)
    expect(archive.status).toBe('ready')

    const { files } = await readArchive(result.archive.id)
    const drafts = JSON.parse(
      files.get('activities.next/drafts.json')!.toString()
    )
    expect(drafts.drafts).toHaveLength(1)
    expect(drafts.drafts[0].text).toBe('hello draft')
    const text = JSON.stringify(drafts)
    expect(text).not.toContain('idempotency-key')
    expect(text).not.toContain('AAAA')
    expect(text).not.toContain('hasBlob')
  })

  it('removes the staged parts and emails the owner once the archive is ready', async () => {
    const id = await makeArchive(accountId)
    const archive = await runToCompletion(id)
    expect(archive.status).toBe('ready')

    // Only the finished file is left under the export's secret segment.
    const entries = await fs.readdir(await archiveDir(id))
    expect(entries).toEqual([archive.storagePath!.split('/').pop()])
    expect(archive.storagePath).toMatch(
      new RegExp(`^archives/${id}/[A-Za-z0-9_-]{43}/archive-[0-9a-f]+\\.zip$`)
    )

    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = vi.mocked(sendMail).mock.calls[0][0]
    expect(mail.to).toEqual([seedActor1.email])
    expect(JSON.stringify(mail.content)).toContain(
      `/api/v1/account/archives/${id}/download`
    )

    // A delayed expiry is queued for 7 days out.
    const expiry = published.find(
      (message) => (message.data as { action?: string }).action === 'expire'
    ) as unknown as { delaySeconds: number }
    expect(expiry.delaySeconds).toBe(7 * 24 * 60 * 60)
  })

  it('finishes with the same content when a slice dies after staging a page', async () => {
    const baselineId = await makeArchive(accountId)
    await runToCompletion(baselineId)
    const baseline = await readArchive(baselineId)

    const id = await makeArchive(accountId)
    // Calls: mark running, save the first cursor, then the first page's cursor.
    // Failing the third leaves that page's parts on disk with no cursor counting
    // them, as if the worker had been killed there.
    const original = database.updateAccountArchive.bind(database)
    let calls = 0
    vi.spyOn(database, 'updateAccountArchive').mockImplementation(
      async (params) => {
        calls += 1
        if (calls === 3) throw new Error('worker killed')
        return original(params)
      }
    )
    await expect(run(id, 0)).rejects.toThrow('worker killed')
    const interrupted = await database.getAccountArchive({ id })
    expect(interrupted!.status).toBe('running')

    // The queue delivers the same message again.
    const archive = await runToCompletion(id)
    expect(archive.status).toBe('ready')
    const resumed = await readArchive(id)

    expect(resumed.names).toEqual(baseline.names)
    for (const name of baseline.names) {
      if (name === 'activities.next/manifest.json') continue
      expect(resumed.files.get(name)!.toString(), name).toBe(
        baseline.files.get(name)!.toString()
      )
    }
  })

  it('ignores a continuation that is older than the saved cursor', async () => {
    const id = await makeArchive(accountId)
    await run(id, 0)
    await run(id, 1)
    const before = (await database.getAccountArchive({ id }))!.progress
    await run(id, 0)
    expect((await database.getAccountArchive({ id }))!.progress).toBe(before)
  })

  it('marks the export failed after three failing slices and deletes its files', async () => {
    const id = await makeArchive(accountId)
    await run(id, 0)
    vi.spyOn(database, 'getAccountExportRows').mockRejectedValue(
      new Error('database is down')
    )
    await expect(run(id, 1)).rejects.toThrow('database is down')
    await expect(run(id, 1)).rejects.toThrow('database is down')
    await run(id, 1)

    const archive = (await database.getAccountArchive({ id }))!
    expect(archive.status).toBe('failed')
    // A fixed sentence: the cause stays in the logs.
    expect(archive.error).toBe('The export could not be completed')
    await expect(fs.stat(path.join(root, 'archives', id))).rejects.toThrow()
  })

  it('expires a ready archive: deletes the file and refuses the download state', async () => {
    const id = await makeArchive(accountId)
    await runToCompletion(id)
    const ready = (await database.getAccountArchive({ id }))!
    await run(id, 0, 'expire')
    // Not due yet: nothing happens.
    expect((await database.getAccountArchive({ id }))!.status).toBe('ready')

    await database.updateAccountArchive({ id, expiresAt: Date.now() - 1000 })
    await run(id, 0, 'expire')
    const expired = (await database.getAccountArchive({ id }))!
    expect(expired.status).toBe('expired')
    expect(expired.storagePath).toBeNull()
    await expect(fs.stat(path.join(root, ready.storagePath!))).rejects.toThrow()
  })

  it('fails the export when no storage is configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      ...baseConfig(),
      mediaStorage: undefined
    } as ReturnType<typeof getConfig>)
    expect(getArchiveObjectStore()).toBeNull()
    const id = await makeArchive(accountId)
    await run(id, 0)
    expect((await database.getAccountArchive({ id }))!.status).toBe('failed')
  })

  describe('files copied into the archive', () => {
    const MIB = 1024 * 1024
    const bigPath = 'medias/2026-01-02/export-big.bin'
    let bigBytes: Buffer

    beforeAll(async () => {
      bigBytes = crypto.randomBytes(3 * MIB + 77)
      await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: bigPath,
          bytes: bigBytes.length,
          mimeType: 'application/octet-stream',
          metaData: { width: 1, height: 1 }
        }
      })
    })

    it('copies a large file across slices by byte range, to an intact zip', async () => {
      const target = path.join(root, bigPath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, bigBytes)
      const id = await makeArchive(accountId)

      // Count the slices: with no time budget each slice copies one chunk.
      let slices = 0
      await run(id, 0)
      for (;;) {
        const next = published.find(
          (message) =>
            (message.data as { action?: string }).action === undefined
        )
        if (!next) break
        published.splice(published.indexOf(next), 1)
        slices += 1
        await run(id, (next.data as { slice: number }).slice)
      }
      expect(slices).toBeGreaterThan(10)

      const archive = (await database.getAccountArchive({ id }))!
      expect(archive.status).toBe('ready')
      const { files } = await readArchive(id)
      expect(files.get(getArchiveMediaPath(bigPath))?.equals(bigBytes)).toBe(
        true
      )
    })

    it('closes the source file when writing the archive fails', async () => {
      const target = path.join(root, bigPath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, bigBytes)
      const id = await makeArchive(accountId)
      sliceBudget.ms = 10 * 60 * 1000
      const destroy = vi.spyOn(Readable.prototype, 'destroy')
      const open = FileArchiveObjectStore.prototype.openResumableWrite
      vi.spyOn(
        FileArchiveObjectStore.prototype,
        'openResumableWrite'
      ).mockImplementation(async function (
        this: FileArchiveObjectStore,
        ...args
      ) {
        const sink = await open.apply(this, args)
        const write = sink.write.bind(sink)
        // The copy of the big file reads it in chunks of 64 KiB.
        sink.write = async (chunk) => {
          if (chunk.length === 64 * 1024) throw new Error('disk is full')
          return write(chunk)
        }
        return sink
      })

      await expect(run(id, 0)).rejects.toThrow('disk is full')

      const closed = destroy.mock.contexts.some(
        (stream) => (stream as { path?: string }).path === target
      )
      expect(closed).toBe(true)
    })

    it('copies a fitness file from the fitness storage under fitness/files', async () => {
      const fitnessRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-'))
      try {
        vi.mocked(getConfig).mockReturnValue({
          ...baseConfig(),
          fitnessStorage: {
            type: FitnessStorageType.LocalFile,
            path: fitnessRoot
          }
        } as ReturnType<typeof getConfig>)
        const content = Buffer.from('FIT-FILE-BYTES')
        await fs.mkdir(path.join(fitnessRoot, 'fitness'), { recursive: true })
        await fs.writeFile(path.join(fitnessRoot, 'fitness/run.fit'), content)
        const file = await database.createFitnessFile({
          actorId: ACTOR1_ID,
          path: 'fitness/run.fit',
          fileName: 'run.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: content.length
        })

        const id = await makeArchive(accountId)
        await runToCompletion(id)
        const { files } = await readArchive(id)
        expect(
          files
            .get(
              `activities.next/actors/llun.test/test1/fitness/files/${file!.id}.fit`
            )
            ?.equals(content)
        ).toBe(true)
        await db
          .deleteFrom('fitness_files')
          .where('id', '=', file!.id)
          .execute()
      } finally {
        await fs.rm(fitnessRoot, { recursive: true, force: true })
      }
    })

    it('never copies a file whose stored path points at an export or fitness storage', async () => {
      const secret = path.join(root, 'archives/other/token/archive-1.zip')
      await fs.mkdir(path.dirname(secret), { recursive: true })
      await fs.writeFile(secret, 'ANOTHER-ACCOUNTS-EXPORT')
      await fs.mkdir(path.join(root, 'fitness'), { recursive: true })
      await fs.writeFile(path.join(root, 'fitness/private.fit'), 'PRIVATE-FIT')
      for (const original of [
        'archives/other/token/archive-1.zip',
        'fitness/private.fit'
      ]) {
        await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: original,
            bytes: 5,
            mimeType: 'application/zip',
            metaData: { width: 1, height: 1 }
          }
        })
      }

      const id = await makeArchive(accountId)
      await runToCompletion(id)
      const { files } = await readArchive(id)
      const all = [...files.values()].map((buffer) => buffer.toString('latin1'))
      expect(all.some((text) => text.includes('ANOTHER-ACCOUNTS-EXPORT'))).toBe(
        false
      )
      expect(all.some((text) => text.includes('PRIVATE-FIT'))).toBe(false)
      const manifest = JSON.parse(
        files.get('activities.next/manifest.json')!.toString()
      )
      expect(manifest.warnings.join('\n')).toContain('outside the storage root')
    })
  })

  describe('profile images', () => {
    const ownedAvatar = 'medias/2026-01-03/avatar-owned.png'

    const setIcon = (iconUrl: string | null) =>
      database.updateActor({ actorId: ACTOR1_ID, iconUrl })

    afterEach(async () => {
      await setIcon(null)
    })

    it("copies an avatar that is one of the account's own media", async () => {
      await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: ownedAvatar,
          bytes: 6,
          mimeType: 'image/png',
          metaData: { width: 1, height: 1 }
        }
      })
      await fs.mkdir(path.join(root, 'medias/2026-01-03'), { recursive: true })
      await fs.writeFile(path.join(root, ownedAvatar), 'AVATAR')
      await setIcon(`https://${getConfig().host}/api/v1/files/${ownedAvatar}`)

      const id = await makeArchive(accountId)
      await runToCompletion(id)
      const { files } = await readArchive(id)
      expect(files.get('avatar.png')?.toString()).toBe('AVATAR')
    })

    it.each([
      ['another export', 'archives/other/token/archive-1.zip'],
      ['fitness storage', 'fitness/private.fit'],
      [
        'a media file nobody on this account owns',
        'medias/2026-01-03/foreign.png'
      ]
    ])('does not copy an avatar that names %s', async (_label, stored) => {
      const target = path.join(root, stored)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, 'NOT-YOURS')
      await setIcon(`https://${getConfig().host}/api/v1/files/${stored}`)

      const id = await makeArchive(accountId)
      await runToCompletion(id)
      const { names, files } = await readArchive(id)
      expect(names.filter((name) => name.startsWith('avatar'))).toEqual([])
      const manifest = JSON.parse(
        files.get('activities.next/manifest.json')!.toString()
      )
      expect(manifest.warnings.join('\n')).toMatch(
        /not one of the account|outside the storage root/
      )
      for (const buffer of files.values()) {
        expect(buffer.toString('latin1')).not.toContain('NOT-YOURS')
      }
    })
  })

  describe('profile.json settings', () => {
    it('lists only the profile and preference keys, never server bookkeeping', async () => {
      const row = await db
        .selectFrom('actors')
        .select('settings')
        .where('id', '=', ACTOR1_ID)
        .executeTakeFirstOrThrow()
      const original =
        typeof row.settings === 'string'
          ? row.settings
          : JSON.stringify(row.settings)
      await db
        .updateTable('actors')
        .set({
          settings: JSON.stringify({
            ...JSON.parse(original),
            bot: true,
            linksCheckedAt: 123,
            moveProcessing: { at: 1 },
            someFutureInternalKey: 'must-not-leak'
          })
        })
        .where('id', '=', ACTOR1_ID)
        .execute()
      try {
        const id = await makeArchive(accountId)
        await runToCompletion(id)
        const { files } = await readArchive(id)
        const profile = JSON.parse(
          files
            .get('activities.next/actors/llun.test/test1/profile.json')!
            .toString()
        )
        expect(profile.settings.bot).toBe(true)
        expect(profile.settings).not.toHaveProperty('linksCheckedAt')
        expect(profile.settings).not.toHaveProperty('moveProcessing')
        expect(profile.settings).not.toHaveProperty('someFutureInternalKey')
        expect(profile.settings).not.toHaveProperty('inboxUrl')
      } finally {
        await db
          .updateTable('actors')
          .set({ settings: original })
          .where('id', '=', ACTOR1_ID)
          .execute()
      }
    })
  })

  describe('stripExactLocations', () => {
    it('also drops the fitness home point and hidden circles and the gallery hidden locations', async () => {
      const settingsId = crypto.randomUUID()
      await db
        .insertInto('fitness_settings')
        .values({
          id: settingsId,
          actorId: ACTOR1_ID,
          serviceType: 'strava',
          privacyHomeLatitude: 13.1111,
          privacyHomeLongitude: 100.2222,
          privacyHideRadiusMeters: 500,
          privacyLocations: JSON.stringify([
            { latitude: 13.3333, longitude: 100.4444, hideRadiusMeters: 250 }
          ])
        })
        .execute()
      await db
        .insertInto('gallery_settings')
        .values({
          actorId: ACTOR1_ID,
          createdAt: new Date(),
          updatedAt: new Date(),
          hiddenLocations: JSON.stringify([
            { latitude: 13.5555, longitude: 100.6666, hideRadiusMeters: 250 }
          ])
        })
        .execute()
      try {
        const kept = await makeArchive(accountId)
        await runToCompletion(kept)
        const keptFiles = (await readArchive(kept)).files
        const base = 'activities.next/actors/llun.test/test1'
        expect(
          keptFiles.get(`${base}/fitness/settings.json`)!.toString()
        ).toContain('13.1111')

        expect(
          keptFiles.get(`${base}/gallery/settings.json`)!.toString()
        ).toContain('13.5555')

        const stripped = await makeArchive(accountId, {
          stripExactLocations: true
        })
        await runToCompletion(stripped)
        const files = (await readArchive(stripped)).files
        const fitness = files.get(`${base}/fitness/settings.json`)!.toString()
        expect(fitness).not.toContain('13.1111')
        expect(fitness).not.toContain('13.3333')
        expect(fitness).not.toContain('privacyHome')
        const galleryText = files
          .get(`${base}/gallery/settings.json`)!
          .toString()
        expect(galleryText).not.toContain('13.5555')
      } finally {
        await db
          .deleteFrom('fitness_settings')
          .where('id', '=', settingsId)
          .execute()
        await db
          .deleteFrom('gallery_settings')
          .where('actorId', '=', ACTOR1_ID)
          .execute()
      }
    })
  })

  describe('overlapping deliveries', () => {
    it('keeps the finished file when a second delivery completes the same slice', async () => {
      sliceBudget.ms = 10 * 60 * 1000
      const id = await makeArchive(accountId)
      const original = database.updateAccountArchive.bind(database)
      let intercepted = false
      vi.spyOn(database, 'updateAccountArchive').mockImplementation(
        async (params) => {
          if (params.status === 'ready' && !intercepted) {
            intercepted = true
            // Before this worker's final update lands, another delivery of the
            // same slice takes over (its lease long expired) and finishes.
            const current = (await database.getAccountArchive({ id }))!
            const progress = parseProgress(current.progress)!
            progress.lease = null
            await original({
              id,
              progress: serializeProgress(progress)
            })
            await run(id, progress.completed + 1)
          }
          return original(params)
        }
      )

      await run(id, 0)
      const archive = (await database.getAccountArchive({ id }))!
      expect(archive.status).toBe('ready')
      const { names } = await readArchive(id)
      expect(names).toContain('activities.next/manifest.json')
      await expect(
        fs.stat(path.join(root, archive.storagePath!))
      ).resolves.toBeTruthy()
    })

    it('leaves the cursor of the worker that took over alone when a lapsed worker fails', async () => {
      const id = await makeArchive(accountId)
      await run(id, 0)
      let owner: string | null = null
      vi.spyOn(database, 'getAccountExportRows').mockImplementation(
        async () => {
          // While this slice works, another worker takes the export over and
          // saves its own lease; then this slice's call fails (a timeout).
          const current = (await database.getAccountArchive({ id }))!
          const progress = parseProgress(current.progress)!
          progress.lease = { token: 'worker-B', until: Date.now() + 60_000 }
          await database.updateAccountArchive({
            id,
            progress: serializeProgress(progress)
          })
          owner = (await database.getAccountArchive({ id }))!.progress
          throw new Error('request timed out')
        }
      )

      // Acknowledged, not retried: the owner carries the run.
      await run(id, 1)

      const after = (await database.getAccountArchive({ id }))!
      expect(after.progress).toBe(owner)
      expect(parseProgress(after.progress)!.failures).toBe(0)
      expect(after.status).toBe('running')
    })

    it('keeps the export and its files when another worker saves while a third failure is recorded', async () => {
      const id = await makeArchive(accountId)
      await run(id, 0)
      const base = (await database.getAccountArchive({ id }))!
      const progress = parseProgress(base.progress)!
      progress.failures = 2
      await database.updateAccountArchive({
        id,
        progress: serializeProgress(progress)
      })
      vi.spyOn(database, 'getAccountExportRows').mockRejectedValue(
        new Error('request timed out')
      )
      const original = database.updateAccountArchive.bind(database)
      let moved = false
      vi.spyOn(database, 'updateAccountArchive').mockImplementation(
        async (params) => {
          if (params.status === 'failed' && !moved) {
            moved = true
            // Between the failing worker's read and its write, the worker that
            // took over saves its cursor.
            const current = parseProgress(
              (await database.getAccountArchive({ id }))!.progress
            )!
            current.failures = 0
            await original({ id, progress: serializeProgress(current) })
          }
          return original(params)
        }
      )

      await run(id, 1).catch(() => undefined)

      expect(moved).toBe(true)
      expect((await database.getAccountArchive({ id }))!.status).toBe('running')
      await expect(
        fs.stat(path.join(root, 'archives', id))
      ).resolves.toBeTruthy()
    })

    it('stops writing shared parts once its own lease has run out, and the export still ends in a valid zip', async () => {
      const id = await makeArchive(accountId)
      // Collect first, so the next delivery starts the assembly.
      await run(id, 0)
      for (;;) {
        const progress = parseProgress(
          (await database.getAccountArchive({ id }))!.progress
        )!
        if (progress.phase === 'assemble') break
        const next = published.shift()!
        await run(id, (next.data as { slice: number }).slice)
      }
      published.length = 0
      sliceBudget.ms = 10 * 60 * 1000

      // The worker stalls inside the archive output for longer than its lease.
      const realNow = Date.now.bind(Date)
      let offset = 0
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
      const open = FileArchiveObjectStore.prototype.openResumableWrite
      const put = FileArchiveObjectStore.prototype.put
      let jumped = false
      const writtenAfterLapse: string[] = []
      vi.spyOn(
        FileArchiveObjectStore.prototype,
        'openResumableWrite'
      ).mockImplementation(async function (
        this: FileArchiveObjectStore,
        ...args
      ) {
        const sink = await open.apply(this, args)
        const write = sink.write.bind(sink)
        sink.write = async (chunk) => {
          await write(chunk)
          if (!jumped) {
            jumped = true
            offset = 2 * 60 * 60 * 1000
          }
        }
        return sink
      })
      vi.spyOn(FileArchiveObjectStore.prototype, 'put').mockImplementation(
        async function (this: FileArchiveObjectStore, key, body) {
          if (offset > 0 && /\/stage\/(directory|names)-/.test(key)) {
            writtenAfterLapse.push(key)
          }
          return put.call(this, key, body)
        }
      )

      const progress = parseProgress(
        (await database.getAccountArchive({ id }))!.progress
      )!
      await expect(run(id, progress.completed + 1)).rejects.toThrow('lease')
      expect(jumped).toBe(true)
      // Nothing was written to the shared directory keys after the lapse.
      expect(writtenAfterLapse).toEqual([])
      // Not a failure of the export, and not given up on.
      const after = (await database.getAccountArchive({ id }))!
      expect(after.status).toBe('running')
      expect(parseProgress(after.progress)!.failures).toBe(0)

      // The redelivery, with the clock still ahead, finishes it.
      await run(id, progress.completed + 1)
      for (let slices = 0; slices < 50 && published.length > 0; slices += 1) {
        const next = published.shift()!
        await run(id, (next.data as { slice: number }).slice)
      }
      const archive = (await database.getAccountArchive({ id }))!
      expect(archive.status).toBe('ready')
      const { names } = await readArchive(id)
      expect(names).toContain('activities.next/manifest.json')
    })

    describe('a worker that writes late, after another took over', () => {
      /**
       * Holds the first write of a key matching `pattern` made by the next
       * delivery, as a worker stalled inside an object store call would. Once
       * released the write lands with `mutate` applied to its bytes, standing
       * for data that changed between the two workers' reads.
       */
      const holdFirstPut = (pattern: RegExp) => {
        const put = FileArchiveObjectStore.prototype.put
        let hold: ((mutate: (body: Buffer | string) => Buffer) => void) | null =
          null
        let held: Promise<void>
        let markHeld!: () => void
        held = new Promise<void>((resolve) => (markHeld = resolve))
        let taken = false
        vi.spyOn(FileArchiveObjectStore.prototype, 'put').mockImplementation(
          async function (this: FileArchiveObjectStore, key, body) {
            if (!taken && pattern.test(key)) {
              taken = true
              const release = new Promise<(body: Buffer | string) => Buffer>(
                (resolve) => {
                  hold = resolve as typeof hold
                }
              )
              markHeld()
              const mutate = await release
              return put.call(this, key, mutate(body))
            }
            return put.call(this, key, body)
          }
        )
        return {
          held,
          release: (mutate: (body: Buffer | string) => Buffer) => hold!(mutate)
        }
      }

      const lapseClock = () => {
        const realNow = Date.now.bind(Date)
        vi.spyOn(Date, 'now').mockImplementation(
          () => realNow() + 2 * 60 * 60 * 1000
        )
      }

      const finish = async (id: string) => {
        for (
          let slices = 0;
          slices < 600 && published.length > 0;
          slices += 1
        ) {
          const next = published.shift()!
          await run(id, (next.data as { slice: number }).slice)
        }
        const archive = (await database.getAccountArchive({ id }))!
        expect(archive.status).toBe('ready')
        const { names } = await readArchive(id)
        expect(names).toContain('activities.next/manifest.json')
      }

      const junk = (body: Buffer | string) =>
        Buffer.concat([Buffer.from(body), Buffer.from('XXXX')])

      it('writes the same generated document whichever worker writes it out', async () => {
        const id = await makeArchive(accountId)
        // The first write of the manifest to the zip output is held, as a
        // worker stalled inside an upload or a disk write would be.
        const open = FileArchiveObjectStore.prototype.openResumableWrite
        let release!: () => void
        const gate = new Promise<void>((resolve) => (release = resolve))
        let markHeld!: () => void
        const held = new Promise<void>((resolve) => (markHeld = resolve))
        let taken = false
        vi.spyOn(
          FileArchiveObjectStore.prototype,
          'openResumableWrite'
        ).mockImplementation(async function (
          this: FileArchiveObjectStore,
          ...args
        ) {
          const sink = await open.apply(this, args)
          const write = sink.write.bind(sink)
          sink.write = async (chunk) => {
            if (!taken && chunk.includes('"exportedAt"')) {
              taken = true
              markHeld()
              await gate
            }
            return write(chunk)
          }
          return sink
        })

        await run(id, 0)
        let late: Promise<unknown> | null = null
        let slice = 0
        for (let slices = 0; slices < 600 && !late; slices += 1) {
          const message = published.shift()!
          slice = (message.data as { slice: number }).slice
          const delivery = run(id, slice).catch(() => undefined)
          const state = await Promise.race([
            delivery.then(() => 'done'),
            held.then(() => 'held')
          ])
          if (state === 'held') late = delivery
        }
        expect(late).not.toBeNull()
        lapseClock()

        // The new owner takes the same run over and writes the manifest out.
        await run(id, slice)
        release()
        await late

        await finish(id)
      })

      it('cannot replace a staged part the new owner already counted', async () => {
        const id = await makeArchive(accountId)
        await run(id, 0)
        const next = (await published.shift())!.data as { slice: number }
        const hold = holdFirstPut(/\/stage\/[0-9a-f]{24}-\d+/)
        const late = run(id, next.slice).catch(() => undefined)
        await hold.held
        lapseClock()

        // The new owner takes the same run over and stages its own page.
        await run(id, next.slice)
        // Now the stalled worker's write lands, with bytes that differ.
        hold.release(junk)
        await late

        await finish(id)
      })

      it('cannot replace a directory part the new owner already counted', async () => {
        const id = await makeArchive(accountId)
        sliceBudget.ms = 0
        // Collect everything first.
        await run(id, 0)
        for (;;) {
          const progress = parseProgress(
            (await database.getAccountArchive({ id }))!.progress
          )!
          if (progress.phase === 'assemble') break
          const message = published.shift()!
          await run(id, (message.data as { slice: number }).slice)
        }
        const message = published.shift()!.data as { slice: number }
        sliceBudget.ms = 10 * 60 * 1000
        const hold = holdFirstPut(/\/stage\/directory-\d+/)
        const late = run(id, message.slice).catch(() => undefined)
        await hold.held
        lapseClock()
        sliceBudget.ms = 0

        // The new owner resumes from the saved cursor and checkpoints a part.
        await run(id, message.slice)
        hold.release(junk)
        await late

        await finish(id)
      })
    })

    it('makes a delivery wait for the lease instead of dropping it', async () => {
      const id = await makeArchive(accountId)
      await run(id, 0)
      const before = (await database.getAccountArchive({ id }))!
      const progress = parseProgress(before.progress)!
      progress.lease = { token: 'other-worker', until: Date.now() + 60_000 }
      await database.updateAccountArchive({
        id,
        progress: serializeProgress(progress)
      })
      const held = (await database.getAccountArchive({ id }))!.progress
      const publishedBefore = published.length

      // Not acknowledged: the queue has to bring it back once the lease lapses.
      await expect(run(id, progress.completed + 1)).rejects.toThrow('lease')

      expect((await database.getAccountArchive({ id }))!.progress).toBe(held)
      expect(published.length).toBe(publishedBefore)
      // It is not counted as a failed slice either.
      expect(parseProgress(held)!.failures).toBe(0)
    })

    it('runs the delivery again once the lease has lapsed', async () => {
      const id = await makeArchive(accountId)
      await run(id, 0)
      const before = (await database.getAccountArchive({ id }))!
      const progress = parseProgress(before.progress)!
      progress.lease = { token: 'dead-worker', until: Date.now() - 1 }
      await database.updateAccountArchive({
        id,
        progress: serializeProgress(progress)
      })
      await run(id, progress.completed + 1)
      expect(
        parseProgress((await database.getAccountArchive({ id }))!.progress)!
          .completed
      ).toBe(1)
    })

    it('never publishes a continuation id twice, whatever is delivered again', async () => {
      const id = await makeArchive(accountId)
      const ids: string[] = []
      const queue = vi.mocked(getQueue)()
      const publish = vi.mocked(queue.publish)
      publish.mockImplementation(async (message) => {
        ids.push(message.id)
        published.push(message)
      })

      await run(id, 0)
      expect(ids).toHaveLength(1)
      // The first message is delivered again after it finished: it publishes
      // the next run again under the same id (a queue keeps one copy), never a
      // new id, so a dropped publish can come back and nothing is duplicated.
      await run(id, 0)
      await run(id, 1)
      await run(id, 1)
      await run(id, 0)
      expect(new Set(ids).size).toBe(2)
      expect(ids).toEqual([ids[0], ids[0], ids[2], ids[2]])
    })

    it('publishes the next run again when a redelivery shows the first publish was lost', async () => {
      const id = await makeArchive(accountId)
      const queue = vi.mocked(getQueue)()
      vi.mocked(queue.publish).mockRejectedValueOnce(new Error('queue is down'))

      // The slice saved its progress and released the lease, then the publish
      // failed: the queue brings the same message back.
      await expect(run(id, 0)).rejects.toThrow('queue is down')
      expect(published).toHaveLength(0)

      await run(id, 0)
      expect(published.map((message) => message.data)).toEqual([
        { archiveId: id, slice: 1 }
      ])
      // And that next run is the current one.
      await run(id, 1)
      expect(
        parseProgress((await database.getAccountArchive({ id }))!.progress)!
          .completed
      ).toBe(1)
    })

    it('does not publish again for a redelivery while another worker holds the lease', async () => {
      const id = await makeArchive(accountId)
      await run(id, 0)
      published.length = 0
      const progress = parseProgress(
        (await database.getAccountArchive({ id }))!.progress
      )!
      progress.lease = { token: 'live-worker', until: Date.now() + 60_000 }
      await database.updateAccountArchive({
        id,
        progress: serializeProgress(progress)
      })

      await run(id, 0)

      expect(published).toHaveLength(0)
    })

    it('starts counting reaps again once a run makes progress', async () => {
      const id = await makeArchive(accountId)
      await run(id, 0)
      await database.updateAccountArchive({ id, reapCount: 2 })

      await run(id, 1)

      expect((await database.getAccountArchive({ id }))!.reapCount).toBe(0)
    })

    it('removes what a slice staged when the export is deleted underneath it', async () => {
      sliceBudget.ms = 10 * 60 * 1000
      const id = await makeArchive(accountId)
      const original = database.updateAccountArchive.bind(database)
      let saves = 0
      vi.spyOn(database, 'updateAccountArchive').mockImplementation(
        async (params) => {
          // A later progress save, once parts are staged: the export is deleted
          // meanwhile (its account was removed).
          if (
            params.progress !== undefined &&
            params.onlyIfProgress !== undefined &&
            (saves += 1) === 4
          ) {
            await db
              .deleteFrom('account_archives')
              .where('id', '=', id)
              .execute()
          }
          return original(params)
        }
      )
      await run(id, 0)
      await expect(
        fs.readdir(path.join(root, 'archives', id))
      ).rejects.toThrow()
    })
  })

  describe('Mastodon CSV files', () => {
    const FILES = [
      'following_accounts.csv',
      'lists.csv',
      'muted_accounts.csv',
      'blocked_accounts.csv',
      'blocked_domains.csv',
      'bookmarks.csv'
    ]

    it('puts the six files at the root for the default profile and in the folder of every other profile', async () => {
      const second = await database.createActorForAccount({
        accountId,
        username: 'csvother',
        domain: 'llun.test',
        publicKey: 'public',
        privateKey: 'private'
      })
      expect(second).toBeTruthy()
      try {
        const id = await makeArchive(accountId)
        await runToCompletion(id)
        const { names, files, methods } = await readArchive(id)
        const other = 'activities.next/actors/llun.test/csvother'
        for (const file of FILES) {
          expect(names, file).toContain(file)
          expect(names, `${other}/${file}`).toContain(`${other}/${file}`)
          expect(methods.get(file)).toBe(8)
        }
        const following = files.get('following_accounts.csv')!.toString()
        expect(following.split('\n')[0]).toBe(
          'Account address,Show boosts,Notify on new posts,Languages'
        )
        expect(following.trim().split('\n').length).toBeGreaterThan(1)
        // Another profile's file holds that profile's data, not the default's.
        expect(
          files.get(`${other}/following_accounts.csv`)!.toString().trim()
        ).toBe('Account address,Show boosts,Notify on new posts,Languages')
      } finally {
        await db
          .deleteFrom('actors')
          .where('username', '=', 'csvother')
          .execute()
      }
    })
  })

  describe('assembly across many deliveries', () => {
    it('fails the export after three failing assembly deliveries and cleans up', async () => {
      const id = await makeArchive(accountId)
      // Collect until assembly has started.
      let next = 0
      for (;;) {
        await run(id, next)
        next += 1
        const progress = parseProgress(
          (await database.getAccountArchive({ id }))!.progress
        )!
        if (progress.assembly) break
      }
      const dir = await archiveDir(id)
      await fs.rm(path.join(dir, 'stage'), { recursive: true, force: true })

      // Every delivery fails the same way. The counter used to be reset before
      // assembly ran, so it never reached three and the row stayed `running`.
      let status = 'running'
      for (
        let attempt = 0;
        attempt < 12 && status === 'running';
        attempt += 1
      ) {
        const current = parseProgress(
          (await database.getAccountArchive({ id }))!.progress
        )!
        await run(id, current.completed + 1).catch(() => undefined)
        status = (await database.getAccountArchive({ id }))!.status
      }
      const archive = (await database.getAccountArchive({ id }))!
      expect(archive.status).toBe('failed')
      expect(archive.error).toBe('The export could not be completed')
      await expect(fs.stat(path.join(root, 'archives', id))).rejects.toThrow()
    })

    it('reads each staged part once, however many deliveries the export takes', async () => {
      const id = await makeArchive(accountId)
      const reads = new Map<string, number>()
      const original = FileArchiveObjectStore.prototype.get
      vi.spyOn(FileArchiveObjectStore.prototype, 'get').mockImplementation(
        async function (this: FileArchiveObjectStore, key: string) {
          if (/\/stage\/[0-9a-f]{24}-\d+\.[0-9a-f]{16}$/.test(key)) {
            reads.set(key, (reads.get(key) ?? 0) + 1)
          }
          return original.call(this, key)
        }
      )
      const archive = await runToCompletion(id)
      expect(archive.status).toBe('ready')
      expect(reads.size).toBeGreaterThan(10)
      // Resuming inside an entry seeks to its part instead of re-reading the
      // parts before it.
      expect([...reads.values()].filter((count) => count > 1)).toEqual([])
    })

    it('deflates the staged JSON and stores copied files, and a streaming reader reads the JSON', async () => {
      const id = await makeArchive(accountId)
      await runToCompletion(id)
      const archive = (await database.getAccountArchive({ id }))!
      const file = path.join(root, archive.storagePath!)
      const { methods, files } = await readArchive(id)
      expect(methods.get('outbox.json')).toBe(8)
      expect(methods.get('actor.json')).toBe(8)
      expect(methods.get('activities.next/manifest.json')).toBe(0)
      // The JSON text is smaller in the zip than on its own.
      const raw = [...files.values()].reduce((sum, b) => sum + b.length, 0)
      expect((await fs.stat(file)).size).toBeLessThan(raw)

      const streamed = readZipStreaming(file, root)
      if (streamed) {
        // No entry here has a descriptor, so Java's ZipInputStream reads all.
        expect(streamed.error).toBeNull()
        expect(streamed.sizes.get('outbox.json')).toBe(
          files.get('outbox.json')!.length
        )
      }
    })

    it('keeps a document built during assembly the same across deliveries', async () => {
      const id = await makeArchive(accountId)
      const real = database.getAccountExportAccount.bind(database)
      let calls = 0
      vi.spyOn(database, 'getAccountExportAccount').mockImplementation(
        async (params) => {
          calls += 1
          const account = await real(params)
          // A longer document each time it is built.
          return account && { ...account, signUpDomain: 'x'.repeat(calls * 50) }
        }
      )
      await runToCompletion(id)
      const { files } = await readArchive(id)
      for (const name of [
        'activities.next/account.json',
        'activities.next/manifest.json'
      ]) {
        const text = files.get(name)!.toString()
        expect(() => JSON.parse(text), name).not.toThrow()
      }
      const account = JSON.parse(
        files.get('activities.next/account.json')!.toString()
      )
      expect(account.signUpDomain).toMatch(/^x+$/)
    })
  })
})

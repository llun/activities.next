import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getArchiveMediaPath } from '@/lib/services/accountArchive/actorArchive'
import { getArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import { requestAccountArchive } from '@/lib/services/accountArchive/request'
import {
  collectKeys,
  readZip
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
  ARCHIVE_SLICE_BUDGET_MS: 0,
  ARCHIVE_PAGE_SIZE: 2
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
    await db.deleteFrom('account_archives').execute()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-archive-'))
    vi.mocked(getConfig).mockReturnValue({
      ...baseConfig(),
      mediaStorage: { type: MediaStorageType.LocalFile, path: root }
    } as ReturnType<typeof getConfig>)
    published.length = 0
    vi.mocked(sendMail).mockClear()
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish: vi.fn(async (message) => {
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
    return readZip(path.join(root, archive.storagePath!))
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
      'manifest.json',
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
    expect(names[names.length - 1]).toBe('manifest.json')

    const actor = JSON.parse(files.get('actor.json')!.toString())
    expect(actor.type).toBe('Person')
    expect(actor.preferredUsername).toBe('test1')

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

    const manifest = JSON.parse(files.get('manifest.json')!.toString())
    expect(manifest.format).toBe('activities.next-archive')
    expect(manifest.actors[0]).toMatchObject({
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
    const manifest = JSON.parse(files.get('manifest.json')!.toString())
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
      const manifest = JSON.parse(files.get('manifest.json')!.toString())
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

    const entries = await fs.readdir(path.join(root, 'archives', id))
    expect(entries).toEqual(['archive.zip'])

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
      if (name === 'manifest.json') continue
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
})

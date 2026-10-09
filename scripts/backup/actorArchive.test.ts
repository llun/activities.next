import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MAX_FEDERATION_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

import {
  MEDIA_ARCHIVE_DIR,
  buildActorJson,
  buildExportActivity,
  buildFollowersCsv,
  buildFollowingCsv,
  copyProfileImage,
  createOrderedCollectionWriter,
  csvEscape,
  forEachActorStatus,
  forEachFitnessFile,
  forEachLike,
  getArchiveFitnessPath,
  getArchiveMediaPath,
  parseExportActorArgs
} from './actorArchive'
import { buildAttachment } from './actorArchive.testUtils'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

const buildStatus = (overrides: Partial<Status> = {}): Status =>
  ({
    id: 'https://example.test/users/alice/statuses/1',
    actorId: 'https://example.test/users/alice',
    actor: null,

    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],

    isLocalActor: true,
    createdAt: 1,
    updatedAt: 1,

    type: StatusType.enum.Note,
    url: 'https://example.test/@alice/1',
    text: 'hello world',
    reply: '',
    replies: [],

    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,

    attachments: [],
    tags: [],

    ...overrides
  }) as Status

describe('parseExportActorArgs', () => {
  it('throws when no actor selector is given', () => {
    expect(() => parseExportActorArgs([])).toThrow()
  })

  it('throws when more than one actor selector is given', () => {
    expect(() =>
      parseExportActorArgs(['--username', 'alice', '--email', 'a@example.test'])
    ).toThrow()
  })

  it('applies defaults for a bare --username selector', () => {
    const args = parseExportActorArgs(['--username', 'alice'])
    expect(args).toMatchObject({
      username: 'alice',
      domain: undefined,
      actorId: undefined,
      email: undefined,
      envFile: '.env.production',
      outputDir: 'backups/actor-archives',
      pageSize: 100,
      allowMissingStorage: false,
      skipStorage: false,
      fetchRemoteAttachments: false,
      remoteFetchBudgetSeconds: 3600
    })
  })

  it('parses --key=value form and boolean flags', () => {
    const args = parseExportActorArgs([
      '--actor-id=https://example.test/users/alice',
      '--page-size=25',
      '--allow-missing-storage',
      '--skip-storage',
      '--fetch-remote-attachments',
      '--remote-fetch-budget=900'
    ])
    expect(args).toMatchObject({
      actorId: 'https://example.test/users/alice',
      pageSize: 25,
      allowMissingStorage: true,
      skipStorage: true,
      fetchRemoteAttachments: true,
      remoteFetchBudgetSeconds: 900
    })
  })

  it('throws on a non-numeric --page-size', () => {
    expect(() =>
      parseExportActorArgs(['--username', 'alice', '--page-size', 'nope'])
    ).toThrow()
  })

  // Zero is the interesting row: it is a live budget meaning "start nothing",
  // so reading it as "unbounded" would restore the very stall this bounds.
  it.each([
    { description: 'a non-numeric value', value: 'nope' },
    { description: 'zero', value: '0' },
    { description: 'a negative value', value: '-1' },
    { description: 'a fractional value', value: '1.5' }
  ])('throws on $description for --remote-fetch-budget', ({ value }) => {
    expect(() =>
      parseExportActorArgs([
        '--username',
        'alice',
        '--remote-fetch-budget',
        value
      ])
    ).toThrow(/--remote-fetch-budget/)
  })
})

describe('copyProfileImage', () => {
  // The media directory a stored path is confined to, computed the way
  // `copyProfileImage` computes it. The literal behind the constant stays
  // pinned separately, by the `getArchiveMediaPath` tests below.
  const archiveMediaDir = (stagingDir: string) =>
    path.resolve(stagingDir, MEDIA_ARCHIVE_DIR)

  // `vi.mock` builds this `vi.fn()` once for the whole file and neither
  // `clearAllMocks` nor `restoreAllMocks` runs between these tests, so its
  // calls would otherwise accumulate across the cases below.
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  // The archive root sits inside a wider temp root so a traversal out of it
  // has somewhere real to land: `media_attachments/files` is two levels below
  // the staging directory, so `../../../secrets/env` resolves to a file the
  // archive must never contain.
  const withArchiveRoot = async (
    run: (paths: { stagingDir: string; secretPath: string }) => Promise<void>
  ) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-profile-test-')
    )
    const stagingDir = path.join(root, 'staging')
    const secretPath = path.join(root, 'secrets', 'env')

    try {
      await fs.mkdir(stagingDir, { recursive: true })
      await fs.mkdir(path.dirname(secretPath), { recursive: true })
      await fs.writeFile(secretPath, 'ACTIVITIES_SECRET=hunter2')
      await run({ stagingDir, secretPath })
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  }

  it('copies a profile image stored inside the archive media directory', async () => {
    await withArchiveRoot(async ({ stagingDir }) => {
      const source = path.join(stagingDir, getArchiveMediaPath('ab/cd.webp'))
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.writeFile(source, 'avatar-bytes')

      const warnings: string[] = []
      const fileName = await copyProfileImage({
        stagingDir,
        storagePath: 'ab/cd.webp',
        fileNamePrefix: 'avatar',
        warnings
      })

      expect(fileName).toBe('avatar.webp')
      expect(
        await fs.readFile(path.join(stagingDir, 'avatar.webp'), 'utf-8')
      ).toBe('avatar-bytes')
      expect(warnings).toEqual([])
    })
  })

  // As `copyProfileImage`'s own comment explains, `getMediaPathFromFileUrl`
  // refuses a `..` segment before one can reach it. These cases exercise the
  // local re-check it makes anyway, through the shared
  // `resolveStorageFilePath`.
  it.each([
    {
      description: 'traverses out of the media dir',
      buildStoragePath: () => '../../../secrets/env'
    },
    {
      description: 'is exactly one level up',
      buildStoragePath: () => '..'
    },
    {
      description: 'is absolute and outside',
      buildStoragePath: (secretPath: string) => secretPath
    },
    {
      // The one case of the four a prefix compare with no separator boundary
      // would still let through, so it is what would catch such a check being
      // inlined here again. `storagePath.test.ts` pins that for the helper;
      // nothing pinned it for this call site.
      description: 'names a sibling the media dir prefixes',
      buildStoragePath: () => '../files-backup/x'
    }
  ])(
    'refuses a profile image whose stored path $description',
    async ({ buildStoragePath }) => {
      await withArchiveRoot(async ({ stagingDir, secretPath }) => {
        const storagePath = buildStoragePath(secretPath)
        const warnings: string[] = []

        const fileName = await copyProfileImage({
          stagingDir,
          storagePath,
          fileNamePrefix: 'avatar',
          warnings
        })

        expect(fileName).toBeNull()
        expect(warnings).toEqual([
          `Refused avatar image path outside the archive media directory: ${storagePath}`
        ])
        // The assertion that matters: the secret was not read into the archive
        // under the `.bin` fallback name an extension-less path produces.
        await expect(
          fs.readFile(path.join(stagingDir, 'avatar.bin'), 'utf-8')
        ).rejects.toThrow()
        // And the refusal came from the shared helper. That is the half no
        // result can show: the hand-rolled `path.relative` check this replaced
        // returns the same null and pushes the same warning for every case
        // here, so its log is the only observable difference between the two.
        expect(logger.warn).toHaveBeenCalledWith({
          message: 'Refused a storage path outside the storage root',
          storageRootPath: archiveMediaDir(stagingDir),
          filePath: storagePath
        })
      })
    }
  )

  it('warns without copying when the stored path names no file', async () => {
    await withArchiveRoot(async ({ stagingDir }) => {
      const warnings: string[] = []

      const fileName = await copyProfileImage({
        stagingDir,
        storagePath: 'ab/missing.webp',
        fileNamePrefix: 'header',
        warnings
      })

      expect(fileName).toBeNull()
      expect(warnings).toEqual([
        'Could not copy header image from storage: ab/missing.webp'
      ])
    })
  })

  it('returns null without warning when there is no stored path', async () => {
    const warnings: string[] = []
    expect(
      await copyProfileImage({
        stagingDir: '/nonexistent',
        storagePath: null,
        fileNamePrefix: 'avatar',
        warnings
      })
    ).toBeNull()
    expect(warnings).toEqual([])
  })
})

describe('getArchiveMediaPath / getArchiveFitnessPath', () => {
  it('prefixes storage paths with the archive directory', () => {
    expect(getArchiveMediaPath('ab/cd.webp')).toBe(
      'media_attachments/files/ab/cd.webp'
    )
    expect(getArchiveFitnessPath('ab/cd.fit')).toBe(
      'fitness_files/files/ab/cd.fit'
    )
  })
})

describe('csvEscape / buildFollowingCsv / buildFollowersCsv', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('alice@example.test')).toBe('alice@example.test')
  })

  it('quotes and escapes values containing commas or quotes', () => {
    expect(csvEscape('a "quoted", value')).toBe('"a ""quoted"", value"')
  })

  it('builds a Mastodon-import-compatible following CSV', () => {
    const csv = buildFollowingCsv([
      {
        handle: 'alice@example.test',
        showBoosts: true,
        notify: false,
        languages: null
      },
      {
        handle: 'bob@example.test',
        showBoosts: false,
        notify: true,
        languages: ['en', 'th']
      }
    ])
    expect(csv).toBe(
      'Account address,Show boosts,Notify on new posts,Languages\n' +
        'alice@example.test,true,false,\n' +
        'bob@example.test,false,true,"en, th"\n'
    )
  })

  it('builds a followers CSV with just the handle column', () => {
    const csv = buildFollowersCsv(['alice@example.test', 'bob@example.test'])
    expect(csv).toBe('Account address\nalice@example.test\nbob@example.test\n')
  })
})

describe('buildActorJson', () => {
  it('rewrites icon and image URLs to the archived file names', () => {
    const actorJson = buildActorJson({
      person: {
        id: 'https://example.test/users/alice',
        icon: { type: 'Image', mediaType: 'image/jpeg', url: 'https://old' },
        image: { type: 'Image', mediaType: 'image/png', url: 'https://old' }
      },
      avatarFileName: 'avatar.webp',
      headerFileName: 'header.webp'
    })

    expect(actorJson.icon).toEqual({
      type: 'Image',
      mediaType: 'image/jpeg',
      url: 'avatar.webp'
    })
    expect(actorJson.image).toEqual({
      type: 'Image',
      mediaType: 'image/png',
      url: 'header.webp'
    })
  })

  it('leaves icon/image untouched when no local copy exists', () => {
    const actorJson = buildActorJson({
      person: { id: 'https://example.test/users/alice' },
      avatarFileName: null,
      headerFileName: null
    })
    expect(actorJson.icon).toBeUndefined()
    expect(actorJson.image).toBeUndefined()
  })
})

describe('buildExportActivity', () => {
  const urlToArchivePath = (url: string) =>
    url === 'https://example.test/api/v1/files/ab/cd.webp'
      ? 'media_attachments/files/ab/cd.webp'
      : url

  it('shapes an Announce as a reference to the boosted status id', () => {
    const originalStatus = buildStatus({
      id: 'https://example.test/users/bob/statuses/1'
    })
    const status = buildStatus({
      id: 'https://example.test/users/alice/statuses/announce-1',
      type: StatusType.enum.Announce,
      originalStatus
    } as Partial<Status>)

    const activity = buildExportActivity({ status, urlToArchivePath })

    expect(activity).toMatchObject({
      id: status.id,
      type: 'Announce',
      object: originalStatus.id
    })
    expect(activity).not.toHaveProperty('attachment')
  })

  it('keeps every attachment, beyond the federation cap, and rewrites local URLs', () => {
    const attachments = Array.from(
      { length: MAX_FEDERATION_MEDIA_ATTACHMENTS + 1 },
      (_, index) =>
        buildAttachment({
          id: `attachment-${index}`,
          url: `https://example.test/api/v1/files/photo-${index}.webp`
        })
    )
    // One attachment resolves through the local-file URL map; the rest are
    // left as absolute URLs (as a remote/unmapped attachment would be).
    attachments[0] = buildAttachment({
      id: 'attachment-0',
      url: 'https://example.test/api/v1/files/ab/cd.webp'
    })
    const status = buildStatus({ attachments })

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as { attachment: { url: string }[] }

    expect(object.attachment).toHaveLength(attachments.length)
    expect(object.attachment[0].url).toBe('media_attachments/files/ab/cd.webp')
    expect(object.attachment[1].url).toBe(attachments[1].url)
  })

  it('keeps fitness attachments, which the federation serializer drops', () => {
    const status = buildStatus({
      attachments: [
        buildAttachment({
          id: 'fitness-attachment',
          mediaType: 'application/vnd.ant.fit',
          url: 'https://example.test/api/v1/fitness-files/abc',
          name: 'ride.fit'
        })
      ]
    })

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as { attachment: { url: string }[] }

    expect(object.attachment).toHaveLength(1)
  })

  it('strips embedded reply objects but keeps the totalItems count', () => {
    const status = buildStatus({
      replies: [buildStatus({ id: 'reply-1' })]
    })

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as {
      replies: { totalItems: number; items?: unknown }
    }

    expect(object.replies.totalItems).toBe(1)
    expect(object.replies).not.toHaveProperty('items')
  })

  it('shapes a Poll as a Create wrapping a Question with attachments retained', () => {
    const status = buildStatus({
      type: StatusType.enum.Poll,
      choices: [
        {
          statusId: 'status-1',
          title: 'A',
          totalVotes: 1,
          createdAt: 1,
          updatedAt: 1
        },
        {
          statusId: 'status-1',
          title: 'B',
          totalVotes: 2,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      endAt: Date.now() + 1000,
      pollType: 'oneOf',
      attachments: [buildAttachment()]
    } as Partial<Status>)

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as {
      type: string
      attachment: unknown[]
    }

    expect(activity.type).toBe('Create')
    expect(object.type).toBe('Question')
    expect(object.attachment).toHaveLength(1)
  })
})

describe('createOrderedCollectionWriter', () => {
  it('round-trips items into a valid OrderedCollection JSON document', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-writer-test-')
    )
    const filePath = path.join(dir, 'collection.json')

    try {
      const writer = createOrderedCollectionWriter(
        filePath,
        'https://example.test/users/alice/outbox'
      )
      writer.addItem({ id: 'a' })
      writer.addItem({ id: 'b' })
      const count = await writer.close()

      expect(count).toBe(2)

      const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      expect(parsed).toEqual({
        // The outbox collection embeds notes from toActivityPubObject, which
        // emits the FEP-044f quote aliases; anything that compacts this file
        // drops every term its context never defined.
        '@context': NOTE_ACTIVITY_CONTEXT,
        id: 'https://example.test/users/alice/outbox',
        type: 'OrderedCollection',
        orderedItems: [{ id: 'a' }, { id: 'b' }],
        totalItems: 2
      })
    } finally {
      await fs.rm(dir, { force: true, recursive: true })
    }
  })

  it('produces an empty orderedItems array when no item is added', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-writer-test-')
    )
    const filePath = path.join(dir, 'collection.json')

    try {
      const writer = createOrderedCollectionWriter(filePath, 'id-1')
      const count = await writer.close()
      expect(count).toBe(0)

      const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      expect(parsed.orderedItems).toEqual([])
      expect(parsed.totalItems).toBe(0)
    } finally {
      await fs.rm(dir, { force: true, recursive: true })
    }
  })
})

describe('database-backed collectors', () => {
  const domain = 'actor-archive-test.llun.test'
  // A fresh database per test: the forEachActorStatus test asserts an exact
  // count, so it must not inherit the statuses the forEachLike test creates for
  // the same actor.
  let database: ReturnType<typeof getTestSQLDatabase>
  let actorId: string
  let followersUrl: string

  beforeEach(async () => {
    database = getTestSQLDatabase()
    await database.migrate()

    await database.createAccount({
      domain,
      email: 'archive-owner@example.test',
      username: 'archiveowner',
      privateKey: 'test-private-key',
      publicKey: 'test-public-key',
      passwordHash: 'unused'
    })
    const actor = await database.getActorFromUsername({
      username: 'archiveowner',
      domain
    })
    if (!actor) throw new Error('Failed to seed actor for actorArchive tests')
    actorId = actor.id
    followersUrl = actor.followersUrl
  })

  afterEach(async () => {
    await database.destroy()
  })

  describe('forEachActorStatus', () => {
    it('paginates past a page smaller than the total and includes non-public statuses', async () => {
      const total = 5
      for (let index = 0; index < total; index += 1) {
        await database.createNote({
          id: `${actorId}/statuses/pagination-${index}`,
          actorId,
          // Every status is included regardless of audience: the last one
          // carries no public recipient at all.
          to: index === total - 1 ? [] : [ACTIVITY_STREAM_PUBLIC],
          cc: index === total - 1 ? [] : [followersUrl],
          url: `https://${domain}/statuses/pagination-${index}`,
          text: `status ${index}`,
          createdAt: Date.now() + index
        })
      }

      const collected: string[] = []
      for await (const status of forEachActorStatus(database, actorId, 2)) {
        collected.push(status.id)
      }

      expect(collected).toHaveLength(total)
      expect(new Set(collected).size).toBe(total)
      expect(collected).toContain(`${actorId}/statuses/pagination-${total - 1}`)
    })
  })

  describe('forEachFitnessFile', () => {
    it('paginates past a page smaller than the total', async () => {
      const total = 3
      for (let index = 0; index < total; index += 1) {
        await database.createFitnessFile({
          actorId,
          path: `mock/${actorId}/pagination-${index}.gpx`,
          fileName: `pagination-${index}.gpx`,
          fileType: 'gpx',
          mimeType: 'application/gpx+xml',
          bytes: 100
        })
      }

      const collected: string[] = []
      for await (const file of forEachFitnessFile(database, actorId, 2)) {
        collected.push(file.id)
      }

      expect(collected).toHaveLength(total)
      expect(new Set(collected).size).toBe(total)
    })
  })

  describe('forEachLike', () => {
    it('paginates using the composite favourite cursor', async () => {
      const total = 3
      const statusIds: string[] = []
      for (let index = 0; index < total; index += 1) {
        const status = await database.createNote({
          id: `${actorId}/statuses/like-target-${index}`,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          url: `https://${domain}/statuses/like-target-${index}`,
          text: `like target ${index}`,
          createdAt: Date.now() + index
        })
        statusIds.push(status.id)
        await database.createLike({ actorId, statusId: status.id })
      }

      const collected: string[] = []
      for await (const like of forEachLike(database, actorId, 2)) {
        collected.push(like.statusId)
      }

      expect(collected).toHaveLength(total)
      expect(new Set(collected)).toEqual(new Set(statusIds))
    })
  })
})

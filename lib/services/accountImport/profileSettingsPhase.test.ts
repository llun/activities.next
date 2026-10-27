import sharp from 'sharp'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { planArchiveActors } from '@/lib/services/accountArchive/layout'
import {
  AccountImportArchiveChangedError,
  type AccountImportObjectStore
} from '@/lib/services/accountImport/objectStore'
import {
  type AccountImportPhaseContext,
  runProfilePhase,
  runSettingsPhase
} from '@/lib/services/accountImport/phases'
import { createInitialImportProgress } from '@/lib/services/accountImport/progress'
import {
  buildZip,
  sourceOf
} from '@/lib/services/accountImport/zip/testing/fixtures'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { saveMedia } from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import type { AccountImport } from '@/lib/types/domain/accountImport'

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn()
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveMedia: vi.fn()
}))

const SAVED_AVATAR_URL = 'https://llun.test/media/avatar-saved.png'
const SAVED_HEADER_URL = 'https://llun.test/media/header-saved.png'

describe('account import profile and settings phases', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  let actorId: string
  let accountId: string

  const imageBytes = async (format: 'jpeg' | 'png') => {
    const pipeline = sharp({
      create: { width: 8, height: 8, channels: 3, background: '#808080' }
    })
    return (format === 'jpeg' ? pipeline.jpeg() : pipeline.png()).toBuffer()
  }

  const objectStoreOf = (archive: Buffer): AccountImportObjectStore =>
    ({
      openSource: async () => sourceOf(archive)
    }) as unknown as AccountImportObjectStore

  const makeContext = (
    accountImport: AccountImport,
    archive: Buffer
  ): AccountImportPhaseContext => ({
    database,
    objectStore: objectStoreOf(archive),
    accountImport,
    now: () => 0,
    deadline: Number.MAX_SAFE_INTEGER,
    renew: vi.fn()
  })

  const createImport = async (id: string, options: string, kind: string) => {
    await database.createAccountImport({ id, accountId, actorId, options })
    await database.updateAccountImport({ id, status: 'running', kind })
    return (await database.getAccountImport({ id, actorId }))!
  }

  const resetActorProfile = async () => {
    await db
      .updateTable('actors')
      .set({ name: null, summary: null })
      .where('id', '=', actorId)
      .execute()
    await database.updateActor({
      actorId,
      iconUrl: null,
      headerImageUrl: null,
      fields: [],
      movedTo: null,
      alsoKnownAs: []
    })
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    const actor = await database.getActorFromEmail({ email: seedActor1.email })
    actorId = actor!.id
    accountId = actor!.account!.id
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
    await resetActorProfile()
    vi.mocked(publishActorUpdate).mockClear()
    vi.mocked(saveMedia)
      .mockReset()
      .mockImplementation(async () => {
        // Only the saved url reaches the actor row; the rest of the stored
        // media shape is the one saveMedia answers with.
        const saved = {
          id: 'saved-profile-image',
          type: 'image' as const,
          mime_type: 'image/png',
          url: SAVED_AVATAR_URL,
          meta: {
            original: { width: 8, height: 8, size: '8x8', aspect: 1 }
          },
          description: null,
          blurhash: null
        }
        return vi.mocked(saveMedia).mock.calls.length === 1
          ? saved
          : { ...saved, url: SAVED_HEADER_URL }
      })
  })

  it('applies the name, bio, fields, avatar and header of a valid archive', async () => {
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/archive',
            type: 'Person',
            preferredUsername: 'archive',
            name: 'Imported Name',
            summary: 'Imported bio',
            icon: { type: 'Image', mediaType: 'image/png', url: 'avatar.png' },
            image: { type: 'Image', mediaType: 'image/png', url: 'header.png' },
            attachment: [
              {
                type: 'PropertyValue',
                name: 'Web',
                value: 'https://example.test'
              }
            ]
          })
        )
      },
      { name: 'avatar.png', data: await imageBytes('jpeg') },
      { name: 'header.png', data: await imageBytes('png') }
    ])
    const accountImport = await createImport(
      'import-profile-apply',
      '{"profile":true}',
      'mastodon'
    )

    const result = await runProfilePhase(
      makeContext(accountImport, archive),
      createInitialImportProgress()
    )

    expect(result.result).toBe('done')
    const actor = (await database.getActorFromId({ id: actorId }))!
    expect(actor.name).toBe('Imported Name')
    expect(actor.summary).toBe('Imported bio')
    expect(actor.fields).toMatchObject([
      { name: 'Web', value: 'https://example.test' }
    ])
    expect(actor.iconUrl).toBe(SAVED_AVATAR_URL)
    expect(actor.headerImageUrl).toBe(SAVED_HEADER_URL)
    expect(vi.mocked(publishActorUpdate)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishActorUpdate)).toHaveBeenCalledWith({ actorId })
  })

  it('ignores movedTo, alsoKnownAs, verifiedAt and unknown keys', async () => {
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/archive',
            type: 'Person',
            preferredUsername: 'archive',
            name: 'Moved Ignore',
            movedTo: 'https://moved.test/users/new',
            alsoKnownAs: ['https://source.test/users/old'],
            publicKey: {
              id: 'https://source.test/users/archive#key',
              owner: 'https://source.test/users/archive',
              publicKeyPem: 'not a key'
            },
            customUnknownKey: 'ignored',
            attachment: [
              {
                type: 'PropertyValue',
                name: 'Web',
                value: 'https://example.test',
                verifiedAt: '2024-01-02T03:04:05Z'
              }
            ]
          })
        )
      }
    ])
    const accountImport = await createImport(
      'import-profile-forbidden',
      '{"profile":true}',
      'mastodon'
    )

    await runProfilePhase(
      makeContext(accountImport, archive),
      createInitialImportProgress()
    )

    const actor = (await database.getActorFromId({ id: actorId }))!
    expect(actor.name).toBe('Moved Ignore')
    expect(actor.movedTo).toBeUndefined()
    expect(actor.alsoKnownAs).toBeUndefined()
    expect(actor.fields).toMatchObject([
      { name: 'Web', value: 'https://example.test' }
    ])
    expect(actor.fields?.[0]?.verifiedAt ?? null).toBeNull()
  })

  it('sniffs a lying avatar extension and skips a non-image header', async () => {
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/archive',
            type: 'Person',
            preferredUsername: 'archive',
            name: 'Sniff Test',
            icon: { type: 'Image', mediaType: 'image/png', url: 'avatar.png' },
            image: { type: 'Image', mediaType: 'image/png', url: 'header.png' }
          })
        )
      },
      // JPEG bytes under a .png name: the sniffed type wins.
      { name: 'avatar.png', data: await imageBytes('jpeg') },
      // Not an image at all: the header is skipped, not stored.
      { name: 'header.png', data: Buffer.from('definitely not an image') }
    ])
    const accountImport = await createImport(
      'import-profile-sniff',
      '{"profile":true}',
      'mastodon'
    )

    await runProfilePhase(
      makeContext(accountImport, archive),
      createInitialImportProgress()
    )

    const actor = (await database.getActorFromId({ id: actorId }))!
    expect(vi.mocked(saveMedia)).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(saveMedia).mock.calls[0][2]
    expect(saved.file.type).toBe('image/jpeg')
    expect(actor.iconUrl).toBe(SAVED_AVATAR_URL)
    expect(actor.headerImageUrl).toBeUndefined()
  })

  // The avatar entry's data spans past the first read-ahead block (4 MiB),
  // so the archive opens, actor.json reads from the cached first block, and
  // only the avatar entry's own data read crosses into the failing range.
  const failingAvatarSource = (archive: Buffer, failure: Error) => ({
    size: archive.length,
    read: async (start: number, endInclusive: number) => {
      if (start === 4 * 1024 * 1024) throw failure
      return Buffer.from(archive.subarray(start, endInclusive + 1))
    }
  })

  const avatarFailureArchive = async () =>
    buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/archive',
            type: 'Person',
            preferredUsername: 'archive',
            name: 'Avatar Failure',
            icon: { type: 'Image', mediaType: 'image/png', url: 'avatar.png' },
            image: { type: 'Image', mediaType: 'image/png', url: 'header.png' }
          })
        )
      },
      {
        name: 'avatar.png',
        data: Buffer.concat([
          await imageBytes('png'),
          Buffer.alloc(5 * 1024 * 1024)
        ])
      },
      { name: 'header.png', data: await imageBytes('png') }
    ])

  it('fails the profile phase when reading the avatar detects a changed archive', async () => {
    const archive = await avatarFailureArchive()
    const failure = new AccountImportArchiveChangedError()
    const accountImport = await createImport(
      'import-profile-avatar-changed',
      '{"profile":true}',
      'mastodon'
    )
    const context: AccountImportPhaseContext = {
      ...makeContext(accountImport, archive),
      objectStore: {
        openSource: async () => failingAvatarSource(archive, failure)
      } as unknown as AccountImportObjectStore
    }

    await expect(
      runProfilePhase(context, createInitialImportProgress())
    ).rejects.toBe(failure)

    // A changed archive is the import's verdict: the profile is not saved.
    const actor = (await database.getActorFromId({ id: actorId }))!
    expect(actor.name ?? null).toBeNull()
    expect(vi.mocked(publishActorUpdate)).not.toHaveBeenCalled()
  })

  it('fails the profile phase when reading the avatar hits a storage error', async () => {
    const archive = await avatarFailureArchive()
    const failure = new Error('S3 unavailable')
    const accountImport = await createImport(
      'import-profile-avatar-transient',
      '{"profile":true}',
      'mastodon'
    )
    const context: AccountImportPhaseContext = {
      ...makeContext(accountImport, archive),
      objectStore: {
        openSource: async () => failingAvatarSource(archive, failure)
      } as unknown as AccountImportObjectStore
    }

    // A transient storage failure must not be silently forgotten either.
    await expect(
      runProfilePhase(context, createInitialImportProgress())
    ).rejects.toBe(failure)
    const actor = (await database.getActorFromId({ id: actorId }))!
    expect(actor.name ?? null).toBeNull()
  })

  it('publishes nothing when nothing changed or the option is off', async () => {
    await database.updateActor({ actorId, name: 'Stable Name' })
    const unchangedArchive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/archive',
            type: 'Person',
            preferredUsername: 'archive',
            name: 'Stable Name'
          })
        )
      }
    ])
    const unchangedImport = await createImport(
      'import-profile-unchanged',
      '{"profile":true}',
      'mastodon'
    )
    await runProfilePhase(
      makeContext(unchangedImport, unchangedArchive),
      createInitialImportProgress()
    )
    expect(vi.mocked(publishActorUpdate)).not.toHaveBeenCalled()
    await database.updateAccountImport({
      id: unchangedImport.id,
      status: 'done'
    })

    const changedArchive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/archive',
            type: 'Person',
            preferredUsername: 'archive',
            name: 'A Different Name'
          })
        )
      }
    ])
    const optionOffImport = await createImport(
      'import-profile-off',
      '{}',
      'mastodon'
    )
    await runProfilePhase(
      makeContext(optionOffImport, changedArchive),
      createInitialImportProgress()
    )
    expect(vi.mocked(publishActorUpdate)).not.toHaveBeenCalled()
    expect(vi.mocked(saveMedia)).not.toHaveBeenCalled()
    const actor = (await database.getActorFromId({ id: actorId }))!
    expect(actor.name).toBe('Stable Name')
  })

  it('restores allowlisted settings and drops the rest', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const sourceExtrasDir = planArchiveActors(
      [{ id: sourceActorId, username: 'archive', domain: 'source.test' }],
      sourceActorId
    )[0].dir
    const archive = buildZip([
      {
        name: `${sourceExtrasDir}/profile.json`,
        data: Buffer.from(
          JSON.stringify({
            id: sourceActorId,
            isDefault: true,
            handle: 'test1@llun.test',
            username: 'test1',
            domain: 'llun.test',
            name: 'From profile.json',
            settings: {
              defaultPrivacy: 'private',
              defaultSensitive: true,
              defaultLanguage: 123,
              postLineLimit: 10,
              readingExpandSpoilers: true,
              notificationPolicy: {
                for_not_following: 'filter',
                for_not_followers: 'accept',
                for_new_accounts: 'drop',
                for_private_mentions: 'accept',
                for_limited_accounts: 'filter'
              },
              discoverable: false,
              movedTo: 'https://moved.test/users/new',
              alsoKnownAs: ['https://old.test/users/x'],
              attributionDomains: ['evil.test'],
              bot: true,
              emailNotifications: { follow: true },
              iconUrl: 'https://evil.test/avatar.png',
              fields: [{ name: 'x', value: 'y' }]
            }
          })
        )
      },
      {
        name: `${sourceExtrasDir}/gallery/settings.json`,
        data: Buffer.from(
          JSON.stringify({
            actorId: 'https://evil.test/actors/x',
            autoDescribe: true,
            galleryDefault: 'never',
            subjectConfidenceThreshold: 33,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
          })
        )
      }
    ])
    const accountImport = await createImport(
      'import-settings-apply',
      '{"settings":true}',
      'activities.next'
    )
    const galleryBefore = await database.getGallerySettings({ actorId })

    const result = await runSettingsPhase(makeContext(accountImport, archive), {
      ...createInitialImportProgress(),
      sourceActorId
    })

    expect(result.result).toBe('done')
    const settings = (await database.getActorSettings({ actorId }))!
    expect(settings.defaultPrivacy).toBe('private')
    expect(settings.defaultSensitive).toBe(true)
    expect(settings.postLineLimit).toBe(10)
    expect(settings.readingExpandSpoilers).toBe(true)
    expect(settings.notificationPolicy).toEqual({
      for_not_following: 'filter',
      for_not_followers: 'accept',
      for_new_accounts: 'drop',
      for_private_mentions: 'accept',
      for_limited_accounts: 'filter'
    })
    expect(settings.discoverable).toBe(false)
    // Not allowlisted, or an invalid value: none of these are written.
    expect(settings.defaultLanguage).toBeUndefined()
    expect(settings.movedTo).toBeUndefined()
    expect(settings.alsoKnownAs).toBeUndefined()
    expect(settings.attributionDomains).toBeUndefined()
    expect(settings.bot).toBeUndefined()
    expect(settings.emailNotifications).toBeUndefined()
    expect(settings.iconUrl).toBeUndefined()
    expect(settings.fields).toEqual([])

    const gallery = await database.getGallerySettings({ actorId })
    expect(gallery.autoDescribe).toBe(true)
    expect(gallery.galleryDefault).toBe('never')
    expect(gallery.subjectConfidenceThreshold).toBe(
      galleryBefore.subjectConfidenceThreshold
    )
  })

  it('restores no settings for a Mastodon archive or a disabled option', async () => {
    const settingsBefore = (await database.getActorSettings({ actorId }))!
    const galleryBefore = await database.getGallerySettings({ actorId })
    const sourceActorId = 'https://source.test/users/archive'
    const sourceExtrasDir = planArchiveActors(
      [{ id: sourceActorId, username: 'archive', domain: 'source.test' }],
      sourceActorId
    )[0].dir
    const archive = buildZip([
      {
        name: `${sourceExtrasDir}/profile.json`,
        data: Buffer.from(
          JSON.stringify({
            id: sourceActorId,
            isDefault: true,
            settings: { defaultPrivacy: 'private', defaultSensitive: true }
          })
        )
      },
      {
        name: `${sourceExtrasDir}/gallery/settings.json`,
        data: Buffer.from(
          JSON.stringify({
            autoDescribe: !galleryBefore.autoDescribe,
            allowEmptyDescription: galleryBefore.allowEmptyDescription,
            subjectHashtags: galleryBefore.subjectHashtags,
            galleryDefault: galleryBefore.galleryDefault,
            defaultPlacePrecision: galleryBefore.defaultPlacePrecision,
            showGear: galleryBefore.showGear,
            mapPublic: galleryBefore.mapPublic,
            lifeListPublic: galleryBefore.lifeListPublic,
            hiddenLocations: galleryBefore.hiddenLocations,
            hideThreatenedPlaces: galleryBefore.hideThreatenedPlaces,
            subjectSuggestionMode: galleryBefore.subjectSuggestionMode,
            subjectConfidenceThreshold:
              galleryBefore.subjectConfidenceThreshold,
            photoEnhance: galleryBefore.photoEnhance
          })
        )
      }
    ])
    const mastodonImport = await createImport(
      'import-settings-mastodon',
      '{"settings":true}',
      'mastodon'
    )
    await runSettingsPhase(makeContext(mastodonImport, archive), {
      ...createInitialImportProgress(),
      sourceActorId
    })
    await database.updateAccountImport({
      id: mastodonImport.id,
      status: 'done'
    })
    const optionOffImport = await createImport(
      'import-settings-off',
      '{}',
      'activities.next'
    )
    await runSettingsPhase(makeContext(optionOffImport, archive), {
      ...createInitialImportProgress(),
      sourceActorId
    })

    const settings = (await database.getActorSettings({ actorId }))!
    expect(settings.defaultPrivacy).toBe(settingsBefore.defaultPrivacy)
    expect(settings.defaultSensitive).toBe(settingsBefore.defaultSensitive)
    const gallery = await database.getGallerySettings({ actorId })
    expect(gallery.autoDescribe).toBe(galleryBefore.autoDescribe)
  })

  it('maps old boolean galleryDefault safely and restores only enum values', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const sourceExtrasDir = planArchiveActors(
      [{ id: sourceActorId, username: 'archive', domain: 'source.test' }],
      sourceActorId
    )[0].dir
    const archiveOf = (galleryDefault: unknown) =>
      buildZip([
        {
          name: `${sourceExtrasDir}/profile.json`,
          data: Buffer.from(
            JSON.stringify({ id: sourceActorId, isDefault: true })
          )
        },
        {
          name: `${sourceExtrasDir}/gallery/settings.json`,
          data: Buffer.from(JSON.stringify({ galleryDefault }))
        }
      ])
    const run = async (id: string, galleryDefault: unknown) => {
      const accountImport = await createImport(
        id,
        '{"settings":true}',
        'activities.next'
      )
      await runSettingsPhase(
        makeContext(accountImport, archiveOf(galleryDefault)),
        {
          ...createInitialImportProgress(),
          sourceActorId
        }
      )
      // One queued or running import per actor: close this one before the
      // next run creates another.
      await database.updateAccountImport({ id, status: 'done' })
    }

    // The old exporter wrote booleans: every enum value is truthy, so `true`
    // carries none of the owner's intent and must not overwrite anything.
    await database.updateGallerySettings({ actorId, galleryDefault: 'subject' })
    await run('import-gallery-boolean', true)
    expect(
      (await database.getGallerySettings({ actorId })).galleryDefault
    ).toBe('subject')

    await run('import-gallery-enum', 'never')
    expect(
      (await database.getGallerySettings({ actorId })).galleryDefault
    ).toBe('never')

    await run('import-gallery-invalid', 'sometimes')
    expect(
      (await database.getGallerySettings({ actorId })).galleryDefault
    ).toBe('never')
  })

  it('rejects an oversized settings document instead of parsing it whole', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const sourceExtrasDir = planArchiveActors(
      [{ id: sourceActorId, username: 'archive', domain: 'source.test' }],
      sourceActorId
    )[0].dir
    const archive = buildZip([
      {
        name: `${sourceExtrasDir}/profile.json`,
        data: Buffer.from(
          JSON.stringify({ id: sourceActorId, isDefault: true })
        )
      },
      {
        name: `${sourceExtrasDir}/gallery/settings.json`,
        data: Buffer.concat([
          Buffer.from('{"padding":"'),
          Buffer.alloc(5 * 1024 * 1024, 0x61),
          Buffer.from('","galleryDefault":"never"}')
        ])
      }
    ])
    const accountImport = await createImport(
      'import-settings-oversized',
      '{"settings":true}',
      'activities.next'
    )
    const galleryBefore = await database.getGallerySettings({ actorId })

    await expect(
      runSettingsPhase(makeContext(accountImport, archive), {
        ...createInitialImportProgress(),
        sourceActorId
      })
    ).rejects.toMatchObject({ reason: 'entry_too_large' })

    const gallery = await database.getGallerySettings({ actorId })
    expect(gallery.galleryDefault).toBe(galleryBefore.galleryDefault)
  })
})

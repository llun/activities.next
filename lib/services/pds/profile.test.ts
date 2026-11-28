import { Secp256k1Keypair } from '@atproto/crypto'
import { cidForRawBytes } from '@atproto/lex-data'
import sharp from 'sharp'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME } from '@/lib/jobs/names'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { createPdsRepo, getPdsRecordValue } from '@/lib/services/pds'
import { uploadPdsBlob } from '@/lib/services/pds/blobs'
import {
  HOSTED_PROFILE_COLLECTION,
  HOSTED_PROFILE_RKEY,
  backfillHostedBlueskyProfile,
  buildHostedBlueskyProfileRecord,
  syncHostedBlueskyProfile
} from '@/lib/services/pds/profile'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'
import {
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))
vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))
vi.mock('@/lib/services/pds/blobs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/services/pds/blobs')>()
  return { ...actual, uploadPdsBlob: vi.fn() }
})
vi.mock('@/lib/services/domains/servedDomainSnapshot', async (original) => ({
  ...(await original<object>()),
  getServedHostConfig: () => ({ host: TEST_DOMAIN })
}))

const PROFILE_URL = `https://${TEST_DOMAIN}/@profile-sync`

describe('buildHostedBlueskyProfileRecord', () => {
  it('cuts the display name to the lexicon limits', () => {
    const record = buildHostedBlueskyProfileRecord({
      actor: { name: 'a'.repeat(100) },
      profileUrl: PROFILE_URL
    })
    expect(record.displayName).toBe('a'.repeat(64))

    const emoji = buildHostedBlueskyProfileRecord({
      actor: { name: '👨‍👩‍👧‍👦'.repeat(64) },
      profileUrl: PROFILE_URL
    })
    expect(
      countBlueskyGraphemes(emoji.displayName as string)
    ).toBeLessThanOrEqual(64)
    expect(
      countBlueskyUtf8Bytes(emoji.displayName as string)
    ).toBeLessThanOrEqual(640)
  })

  it('turns the HTML bio into plain text and appends the profile link', () => {
    const record = buildHostedBlueskyProfileRecord({
      actor: { summary: '<p>Hello <strong>world</strong></p>' },
      profileUrl: PROFILE_URL
    })
    expect(record.description).toBe(`Hello world\n\n${PROFILE_URL}`)
  })

  it('cuts a long bio to 256 graphemes and 2560 bytes, keeping the link', () => {
    const record = buildHostedBlueskyProfileRecord({
      actor: { summary: `<p>${'a'.repeat(400)}</p>` },
      profileUrl: PROFILE_URL
    })
    const description = record.description as string
    expect(description.endsWith(`\n\n${PROFILE_URL}`)).toBe(true)
    expect(countBlueskyGraphemes(description)).toBeLessThanOrEqual(256)
    expect(countBlueskyUtf8Bytes(description)).toBeLessThanOrEqual(2560)
  })

  it('omits the images when there are none, and keeps them when given', () => {
    const bare = buildHostedBlueskyProfileRecord({
      actor: { name: 'Alice' },
      profileUrl: PROFILE_URL
    })
    expect(bare).not.toHaveProperty('avatar')
    expect(bare).not.toHaveProperty('banner')

    const avatar = {
      $type: 'blob' as const,
      ref: {
        $link: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      mimeType: 'image/jpeg',
      size: 10
    }
    const withImages = buildHostedBlueskyProfileRecord({
      actor: { name: 'Alice' },
      profileUrl: PROFILE_URL,
      avatar,
      banner: avatar
    })
    expect(withImages.avatar).toEqual(avatar)
    expect(withImages.banner).toEqual(avatar)
  })
})

describe('syncHostedBlueskyProfile', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  const publish = vi.fn()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: `pds.${TEST_DOMAIN}`,
        allowEmails: [],
        allowActors: [
          'profile-write',
          'profile-images',
          'profile-inactive',
          'profile-plain',
          'profile-webp',
          'profile-disabled',
          'profile-overlap',
          'backfill-missing',
          'backfill-present',
          'backfill-disabled'
        ].map((username) => `${username}@${TEST_DOMAIN}`)
      }
    })
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
    vi.mocked(readStoredImage).mockReset()
    vi.mocked(uploadPdsBlob).mockReset()
    vi.mocked(uploadPdsBlob).mockImplementation(
      async (_database, { bytes, mimeType }) => ({
        cid: 'cid',
        mimeType,
        size: bytes.byteLength,
        storageKey: 'key',
        blob: {
          $type: 'blob',
          ref: await cidForRawBytes(Buffer.from(bytes)),
          mimeType,
          size: bytes.byteLength
        }
      })
    )
  })

  afterAll(async () => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    await database.destroy()
  })

  const createActor = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `ap-priv-${username}`,
      publicKey: `ap-pub-${username}`
    })
    const actor = (await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })) as Actor
    return actor
  }

  const createHosted = async (username: string) => {
    const actor = await createActor(username)
    const did = `did:plc:${username
      .replace(/[^a-z]/g, '')
      .padEnd(24, 'a')
      .slice(0, 24)}`
    await createPdsRepo(database, {
      did,
      actorId: actor.id,
      domain: TEST_DOMAIN,
      handle: `${username}.pds.${TEST_DOMAIN}`,
      signingKey: await Secp256k1Keypair.create({ exportable: true })
    })
    return { actor, did }
  }

  const readProfile = (did: string) =>
    getPdsRecordValue(database, {
      did,
      collection: HOSTED_PROFILE_COLLECTION,
      rkey: HOSTED_PROFILE_RKEY
    })

  it('writes the record once and skips an unchanged second run', async () => {
    const { actor, did } = await createHosted('profile-write')
    await database.updateActor({
      actorId: actor.id,
      name: 'Alice',
      summary: '<p>Hi there</p>'
    })

    await syncHostedBlueskyProfile(database, actor.id)
    const first = await readProfile(did)
    expect(first?.value).toMatchObject({
      $type: HOSTED_PROFILE_COLLECTION,
      displayName: 'Alice',
      description: `Hi there\n\nhttps://${TEST_DOMAIN}/@profile-write`
    })
    const rev = (await database.getPdsRepo({ did }))?.rev

    await syncHostedBlueskyProfile(database, actor.id)
    expect((await database.getPdsRepo({ did }))?.rev).toBe(rev)
    expect((await readProfile(did))?.cid).toBe(first?.cid)
  })

  it('uploads the avatar and banner as blobs', async () => {
    const { actor, did } = await createHosted('profile-images')
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ffffff' }
    })
      .png()
      .toBuffer()
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer: png,
      mimeType: 'image/png'
    })
    vi.spyOn(database, 'ownsAccountExportMediaPath').mockResolvedValue(true)
    await database.updateActor({
      actorId: actor.id,
      iconUrl: `https://${TEST_DOMAIN}/api/v1/files/avatar.png`,
      headerImageUrl: `https://${TEST_DOMAIN}/api/v1/files/header.png`
    })

    await syncHostedBlueskyProfile(database, actor.id)

    const record = (await readProfile(did))?.value
    expect(record?.avatar).toMatchObject({ $type: 'blob' })
    expect(record?.banner).toMatchObject({ $type: 'blob' })
    expect(uploadPdsBlob).toHaveBeenCalledTimes(2)
  })

  it('re-fits a WebP that grows past the limit when converted to JPEG', async () => {
    const { actor, did } = await createHosted('profile-webp')
    const size = 1500
    const raw = Buffer.alloc(size * size * 3)
    let seed = 123456789
    for (let i = 0; i < raw.length; i++) {
      seed = (1103515245 * seed + 12345) & 0x7fffffff
      raw[i] = seed & 0xff
    }
    const webp = await sharp(raw, {
      raw: { width: size, height: size, channels: 3 }
    })
      .webp({ quality: 60 })
      .toBuffer()
    expect(webp.byteLength).toBeLessThanOrEqual(1_000_000)
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer: webp,
      mimeType: 'image/webp'
    })
    vi.spyOn(database, 'ownsAccountExportMediaPath').mockResolvedValue(true)
    await database.updateActor({
      actorId: actor.id,
      iconUrl: `https://${TEST_DOMAIN}/api/v1/files/avatar.webp`
    })

    await syncHostedBlueskyProfile(database, actor.id)

    const [, uploaded] = vi.mocked(uploadPdsBlob).mock.calls[0]
    expect(uploaded.mimeType).toBe('image/jpeg')
    expect(uploaded.bytes.byteLength).toBeLessThanOrEqual(1_000_000)
    const avatar = (await readProfile(did))?.value?.avatar as {
      mimeType: string
      size: number
    }
    expect(avatar.mimeType).toBe('image/jpeg')
    expect(avatar.size).toBeLessThanOrEqual(1_000_000)
  })

  it('skips a repo whose domain PDS is disabled', async () => {
    const { actor, did } = await createHosted('profile-disabled')
    await database.updateActor({ actorId: actor.id, name: 'Alice' })
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: false,
        hostname: `pds.${TEST_DOMAIN}`,
        allowEmails: [],
        allowActors: []
      }
    })

    await expect(
      syncHostedBlueskyProfile(database, actor.id)
    ).resolves.toBeUndefined()

    expect(
      await database.getPdsRecord({
        did,
        collection: HOSTED_PROFILE_COLLECTION,
        rkey: HOSTED_PROFILE_RKEY
      })
    ).toBeNull()
  })

  it('keeps the newest profile when two syncs overlap', async () => {
    const { actor, did } = await createHosted('profile-overlap')
    await database.updateActor({ actorId: actor.id, name: 'First' })

    const first = syncHostedBlueskyProfile(database, actor.id)
    await database.updateActor({ actorId: actor.id, name: 'Second' })
    const second = syncHostedBlueskyProfile(database, actor.id)
    await Promise.all([first, second])

    expect((await readProfile(did))?.value).toMatchObject({
      displayName: 'Second'
    })
  })

  it('skips a repo that is not active', async () => {
    const { actor, did } = await createHosted('profile-inactive')
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })

    await syncHostedBlueskyProfile(database, actor.id)

    expect(
      await database.getPdsRecord({
        did,
        collection: HOSTED_PROFILE_COLLECTION,
        rkey: HOSTED_PROFILE_RKEY
      })
    ).toBeNull()
  })

  it('skips an actor with no hosted repo', async () => {
    const actor = await createActor('profile-plain')

    await expect(
      syncHostedBlueskyProfile(database, actor.id)
    ).resolves.toBeUndefined()
  })
})

describe('backfillHostedBlueskyProfile', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  const publish = vi.fn()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: `pds.${TEST_DOMAIN}`,
        allowEmails: [],
        allowActors: [
          'profile-write',
          'profile-images',
          'profile-inactive',
          'profile-plain',
          'profile-webp',
          'profile-disabled',
          'profile-overlap',
          'backfill-missing',
          'backfill-present',
          'backfill-disabled'
        ].map((username) => `${username}@${TEST_DOMAIN}`)
      }
    })
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
  })

  afterAll(async () => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    await database.destroy()
  })

  const createHosted = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `ap-priv-${username}`,
      publicKey: `ap-pub-${username}`
    })
    const actor = (await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })) as Actor
    const did = `did:plc:${username
      .replace(/[^a-z]/g, '')
      .padEnd(24, 'a')
      .slice(0, 24)}`
    await createPdsRepo(database, {
      did,
      actorId: actor.id,
      domain: TEST_DOMAIN,
      handle: `${username}.pds.${TEST_DOMAIN}`,
      signingKey: await Secp256k1Keypair.create({ exportable: true })
    })
    return { actor, did }
  }

  it('queues the sync when the repo has no profile record', async () => {
    const { actor } = await createHosted('backfill-missing')

    await backfillHostedBlueskyProfile(database, actor)

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME,
        data: { actorId: actor.id }
      })
    )
  })

  it('does nothing when the record already exists', async () => {
    const { actor } = await createHosted('backfill-present')
    await syncHostedBlueskyProfile(database, actor.id)
    publish.mockClear()

    await backfillHostedBlueskyProfile(database, actor)

    expect(publish).not.toHaveBeenCalled()
  })

  it('does not queue when the domain PDS is disabled', async () => {
    const { actor } = await createHosted('backfill-disabled')
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: false,
        hostname: `pds.${TEST_DOMAIN}`,
        allowEmails: [],
        allowActors: []
      }
    })

    await backfillHostedBlueskyProfile(database, actor)

    expect(publish).not.toHaveBeenCalled()
  })
})

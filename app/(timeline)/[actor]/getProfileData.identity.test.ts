import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

import { getProfileData, getProfileIdentity } from './getProfileData'

vi.mock('@/lib/activities/getActorCollectionCounts')
vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')
vi.mock('@/lib/activities/getWebfingerSelf')
vi.mock('@/lib/services/federation/domainPolicy')
vi.mock('@/lib/services/federation/getFederationSigningActor')
vi.mock('@/lib/services/federation/serverSoftware', () => ({
  isPixelfedActor: vi.fn().mockResolvedValue(false),
  isPeerTubeActor: vi.fn().mockResolvedValue(false),
  getServerSoftwareInfo: vi.fn().mockResolvedValue(null)
}))

// Everything `getProfileData` loads for a local account that the followers and
// following pages never render. None of it may be asked for.
const PROFILE_BODY_METHODS = [
  'getActorStatuses',
  'getActorStatusesCount',
  'getAttachmentsForActor',
  'getActorHasFitnessData',
  'getActorHasGalleryMedia',
  'getActorHasVisibleGalleryAlbums',
  'getGallerySettings',
  'getAcceptedOrRequestedFollow'
] as const

describe('getProfileIdentity', () => {
  const mockDatabase = {
    getActorFromUsername: vi.fn(),
    getActorFromId: vi.fn(),
    getActorFollowersCount: vi.fn(),
    getActorFollowingCount: vi.fn(),
    setActorCounters: vi.fn(),
    updateActor: vi.fn(),
    createActor: vi.fn(),
    ...Object.fromEntries(PROFILE_BODY_METHODS.map((name) => [name, vi.fn()]))
  } as unknown as Database

  const localActorId = 'https://example.com/users/localuser'
  const localActor = {
    id: localActorId,
    type: 'Person',
    username: 'localuser',
    domain: 'example.com',
    name: 'Local User',
    summary: 'A local user',
    followersUrl: `${localActorId}/followers`,
    inboxUrl: `${localActorId}/inbox`,
    sharedInboxUrl: 'https://example.com/inbox',
    publicKey: 'public-key',
    privateKey: 'private-key',
    account: { id: 'account-id', email: 'localuser@example.com' },
    followersCount: 21,
    followingCount: 8,
    statusCount: 30,
    lastStatusAt: 0,
    createdAt: 0,
    updatedAt: 0
  } as unknown as DomainActor

  const remotePerson: Actor = {
    type: 'Person',
    id: 'https://remote.com/users/remoteuser',
    preferredUsername: 'remoteuser',
    name: 'Remote User',
    summary: 'A remote user',
    inbox: 'https://remote.com/users/remoteuser/inbox',
    outbox: 'https://remote.com/users/remoteuser/outbox',
    followers: 'https://remote.com/users/remoteuser/followers',
    following: 'https://remote.com/users/remoteuser/following',
    publicKey: {
      id: 'https://remote.com/users/remoteuser#main-key',
      owner: 'https://remote.com/users/remoteuser',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
    }
  }

  const signedInViewer = {
    id: 'https://example.com/users/viewer',
    username: 'viewer',
    domain: 'example.com'
  } as unknown as DomainActor

  beforeEach(() => {
    for (const fn of Object.values(mockDatabase)) {
      vi.mocked(fn as () => unknown).mockReset()
    }
    vi.mocked(getWebfingerSelf).mockReset()
    vi.mocked(getActorPerson).mockReset()
    vi.mocked(getActorPosts).mockReset()
    vi.mocked(getActorCollectionCounts).mockReset()
    vi.mocked(getFederationSigningActorSafe)
      .mockReset()
      .mockResolvedValue(undefined)
    vi.mocked(canFederateWithDomain).mockReset().mockResolvedValue(true)
  })

  describe('a local account', () => {
    beforeEach(() => {
      vi.mocked(mockDatabase.getActorFromUsername).mockResolvedValue(localActor)
    })

    it.each([
      { viewer: 'a signed-out visitor', isLoggedIn: false, currentActor: null },
      {
        viewer: 'a signed-in non-owner',
        isLoggedIn: true,
        currentActor: signedInViewer
      },
      { viewer: 'the owner', isLoggedIn: true, currentActor: localActor }
    ])(
      'answers $viewer from the actor row alone',
      async ({ isLoggedIn, currentActor }) => {
        const identity = await getProfileIdentity(
          mockDatabase,
          '@localuser@example.com',
          isLoggedIn,
          { currentActor }
        )

        expect(identity).toEqual({
          person: getPersonFromActor(localActor),
          followersCount: 21,
          followingCount: 8,
          isInternalAccount: true
        })
        expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
          username: 'localuser',
          domain: 'example.com'
        })
        for (const name of PROFILE_BODY_METHODS) {
          expect(mockDatabase[name]).not.toHaveBeenCalled()
        }
        expect(getWebfingerSelf).not.toHaveBeenCalled()
        expect(getFederationSigningActorSafe).not.toHaveBeenCalled()
      }
    )
  })

  describe('a handle this server hosts no account for', () => {
    it.each([
      { row: 'no row', persistedActor: null },
      {
        row: 'an accountless row',
        persistedActor: { ...localActor, account: undefined }
      }
    ])(
      'is null for a signed-out visitor with $row, without asking WebFinger',
      async ({ persistedActor }) => {
        vi.mocked(mockDatabase.getActorFromUsername).mockResolvedValue(
          persistedActor as DomainActor | null
        )

        const identity = await getProfileIdentity(
          mockDatabase,
          '@localuser@example.com',
          false,
          { currentActor: null }
        )

        expect(identity).toBeNull()
        expect(getWebfingerSelf).not.toHaveBeenCalled()
        expect(getFederationSigningActorSafe).not.toHaveBeenCalled()
        expect(getActorPerson).not.toHaveBeenCalled()
      }
    )

    it('is null for a signed-in viewer when WebFinger does not resolve the handle', async () => {
      vi.mocked(mockDatabase.getActorFromUsername).mockResolvedValue(null)
      vi.mocked(getWebfingerSelf).mockResolvedValue(null)

      const identity = await getProfileIdentity(
        mockDatabase,
        '@nobody@remote.com',
        true,
        { currentActor: signedInViewer }
      )

      expect(identity).toBeNull()
      expect(getWebfingerSelf).toHaveBeenCalledWith({
        account: 'nobody@remote.com'
      })
    })

    it('takes the remote profile path a signed-in viewer gets from getProfileData', async () => {
      vi.mocked(mockDatabase.getActorFromUsername).mockResolvedValue(null)
      vi.mocked(mockDatabase.getActorFromId).mockResolvedValue({
        id: remotePerson.id
      } as DomainActor)
      vi.mocked(mockDatabase.getAttachmentsForActor).mockResolvedValue([])
      vi.mocked(getWebfingerSelf).mockResolvedValue(remotePerson.id)
      vi.mocked(getActorPerson).mockResolvedValue(remotePerson)
      vi.mocked(getActorPosts).mockResolvedValue({
        statuses: [],
        statusesCount: 3
      } as unknown as Awaited<ReturnType<typeof getActorPosts>>)
      vi.mocked(getActorCollectionCounts).mockResolvedValue({
        followersCount: 5370,
        followingCount: 519,
        statusesCount: 3
      })

      const options = { currentActor: null }
      const profile = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        options
      )
      const profileWrites = vi.mocked(mockDatabase.setActorCounters).mock.calls
      vi.mocked(mockDatabase.setActorCounters).mockClear()

      const identity = await getProfileIdentity(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        options
      )

      expect(identity).toEqual({
        person: profile?.person,
        followersCount: profile?.followersCount,
        followingCount: profile?.followingCount,
        isInternalAccount: false
      })
      expect(identity?.followersCount).toBe(5370)
      // The counter sync the profile page performs still happens.
      expect(vi.mocked(mockDatabase.setActorCounters).mock.calls).toEqual(
        profileWrites
      )
      expect(profileWrites).toHaveLength(1)
    })
  })
})

// The mocked suite above pins what is asked; this pins it end to end on a
// real database: the identity of a local account with statuses, followers and
// gallery media reads nothing but the actor, its account and its counters, and
// says exactly what `getProfileData` says about the same fields.
describe('getProfileIdentity on a database', () => {
  const { actors } = DatabaseSeed
  const ownerId = actors.primary.id
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    const { database } = testDb
    await seedDatabase(database)

    await database.createFollow({
      actorId: actors.extra.id,
      targetActorId: ownerId,
      inbox: `${actors.extra.id}/inbox`,
      sharedInbox: `https://${TEST_DOMAIN}/inbox`,
      status: FollowStatus.enum.Accepted
    })
    const statusId = `${ownerId}/statuses/identity-followers-only`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ownerId,
      to: [`${ownerId}/followers`],
      cc: [],
      text: 'followers only'
    })
    const media = await database.createMedia({
      actorId: ownerId,
      original: {
        path: '/test/identity-gallery.jpg',
        bytes: 10,
        mimeType: 'image/jpeg',
        metaData: { width: 10, height: 10 }
      },
      details: { inGallery: true, subjectName: 'Red Fox' }
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId,
      mediaType: 'image/jpeg',
      url: '/test/identity-gallery.jpg',
      mediaId: media!.id
    })
    await database.createNote({
      id: `${ownerId}/statuses/identity-public`,
      url: `${ownerId}/statuses/identity-public`,
      actorId: ownerId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'public'
    })
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const ALLOWED_TABLES = new Set(['actors', 'accounts', 'counters'])
  const tablesOf = (sql: string) =>
    [...sql.matchAll(/\b(?:from|join|into|update)\s+["`]?(\w+)["`]?/gi)].map(
      (match) => match[1]
    )

  it.each([
    { viewer: 'a signed-out visitor', viewerId: null },
    { viewer: 'a follower', viewerId: actors.extra.id },
    { viewer: 'the owner', viewerId: ownerId }
  ])(
    'reads only the actor, its account and its counters for $viewer',
    async ({ viewerId }) => {
      const currentActor = viewerId
        ? await testDb.database.getActorFromId({ id: viewerId })
        : null

      const statements = await testDb.captureQueries(() =>
        getProfileIdentity(testDb.database, '@test1@llun.test', !!viewerId, {
          currentActor
        })
      )

      const tables = new Set(statements.flatMap(({ sql }) => tablesOf(sql)))
      expect([...tables].filter((table) => !ALLOWED_TABLES.has(table))).toEqual(
        []
      )
      expect(tables.has('actors')).toBe(true)
      expect(statements.length).toBeLessThanOrEqual(8)
    }
  )

  it.each(['@test1@llun.test', '@TEST1@llun.test'])(
    'says what getProfileData says about the person and counts for %s',
    async (handle) => {
      const options = { currentActor: null }
      const [profile, identity] = await Promise.all([
        getProfileData(testDb.database, handle, false, options),
        getProfileIdentity(testDb.database, handle, false, options)
      ])

      expect(profile).not.toBeNull()
      expect(identity).toEqual({
        person: profile?.person,
        followersCount: profile?.followersCount,
        followingCount: profile?.followingCount,
        isInternalAccount: profile?.isInternalAccount
      })
      expect(identity?.person.id).toBe(ownerId)
      expect(identity?.followersCount).toBeGreaterThan(0)
      expect(identity?.followingCount).toBeGreaterThan(0)
    }
  )
})

import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { BlockedFederationDomainError, recordActorIfNeeded } from './utils'

const mockGetActorPerson = vi.fn()
const mockGetActorCollectionCounts = vi.fn()

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: (...params: unknown[]) => mockGetActorPerson(...params)
}))

vi.mock('@/lib/activities/getActorCollectionCounts', () => ({
  getActorCollectionCounts: (...params: unknown[]) =>
    mockGetActorCollectionCounts(...params)
}))

const mockPerson = (
  actorId: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: actorId,
  type: 'Person',
  preferredUsername: actorId.split('/').pop(),
  followers: `${actorId}/followers`,
  following: `${actorId}/following`,
  inbox: `${actorId}/inbox`,
  outbox: `${actorId}/outbox`,
  publicKey: {
    id: `${actorId}#main-key`,
    owner: actorId,
    publicKeyPem: 'public-key'
  },
  endpoints: {
    sharedInbox: `${new URL(actorId).origin}/inbox`
  },
  ...overrides
})

describe('recordActorIfNeeded', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetActorCollectionCounts.mockResolvedValue({
      followersCount: null,
      followingCount: null,
      statusesCount: null
    })
  })

  it('rejects actors from blocked domains before fetching them', async () => {
    await database.createDomainBlock({
      domain: 'blocked-record.test',
      severity: 'suspend'
    })

    await expect(
      recordActorIfNeeded({
        actorId: 'https://blocked-record.test/users/alice',
        database
      })
    ).rejects.toThrow(BlockedFederationDomainError)
  })

  it('persists remote profile data and collection counts when recording a new actor', async () => {
    const actorId = 'https://remote-profile.test/users/matteo'
    mockGetActorPerson.mockResolvedValue(
      mockPerson(actorId, {
        name: 'Matteo',
        summary: '<p>I make apps.</p>',
        manuallyApprovesFollowers: false,
        published: '2018-08-10T00:00:00Z',
        icon: { type: 'Image', url: 'https://remote-profile.test/avatar.png' },
        image: { type: 'Image', url: 'https://remote-profile.test/header.png' },
        attachment: [
          {
            type: 'PropertyValue',
            name: 'Website',
            value: 'https://example.com'
          },
          { type: 'SomethingElse', name: 'ignored' }
        ]
      })
    )
    mockGetActorCollectionCounts.mockResolvedValue({
      followersCount: 5370,
      followingCount: 519,
      statusesCount: 641
    })

    const actor = await recordActorIfNeeded({ actorId, database })

    expect(actor).toMatchObject({
      id: actorId,
      name: 'Matteo',
      summary: '<p>I make apps.</p>',
      iconUrl: 'https://remote-profile.test/avatar.png',
      headerImageUrl: 'https://remote-profile.test/header.png'
    })

    const account = await database.getMastodonActorFromId({ id: actorId })
    expect(account).toMatchObject({
      display_name: 'Matteo',
      locked: false,
      followers_count: 5370,
      following_count: 519,
      statuses_count: 641,
      fields: [
        { name: 'Website', value: 'https://example.com', verified_at: null }
      ]
    })
  })

  it('skips remote fetches when the stored actor is fresh and counters are synced', async () => {
    const actorId = 'https://remote-fresh.test/users/synced'
    mockGetActorPerson.mockResolvedValue(mockPerson(actorId))
    mockGetActorCollectionCounts.mockResolvedValue({
      followersCount: 10,
      followingCount: 20,
      statusesCount: 30
    })

    await recordActorIfNeeded({ actorId, database })
    mockGetActorPerson.mockClear()
    mockGetActorCollectionCounts.mockClear()

    const actor = await recordActorIfNeeded({ actorId, database })

    expect(actor?.id).toBe(actorId)
    expect(mockGetActorPerson).not.toHaveBeenCalled()
    expect(mockGetActorCollectionCounts).not.toHaveBeenCalled()
  })

  it('syncs profile and counters for a fresh actor whose counters were never synced', async () => {
    const actorId = 'https://remote-unsynced.test/users/legacy'
    // A remote actor recorded before collection counts were persisted: fresh
    // updatedAt but no counter rows.
    await database.createActor({
      actorId,
      type: 'Person',
      username: 'legacy',
      domain: 'remote-unsynced.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://remote-unsynced.test/inbox',
      publicKey: 'legacy-public-key',
      createdAt: Date.now()
    })

    mockGetActorPerson.mockResolvedValue(
      mockPerson(actorId, {
        name: 'Legacy Actor',
        manuallyApprovesFollowers: false
      })
    )
    mockGetActorCollectionCounts.mockResolvedValue({
      followersCount: 12,
      followingCount: 34,
      statusesCount: 56
    })

    const actor = await recordActorIfNeeded({ actorId, database })

    expect(actor).toMatchObject({ id: actorId, name: 'Legacy Actor' })
    await expect(
      database.getMastodonActorFromId({ id: actorId })
    ).resolves.toMatchObject({
      display_name: 'Legacy Actor',
      locked: false,
      followers_count: 12,
      following_count: 34,
      statuses_count: 56
    })
  })

  it('returns the stored actor when a counter-only sync cannot fetch the person', async () => {
    const actorId = 'https://remote-unreachable.test/users/offline'
    await database.createActor({
      actorId,
      type: 'Person',
      username: 'offline',
      domain: 'remote-unreachable.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://remote-unreachable.test/inbox',
      publicKey: 'offline-public-key',
      createdAt: Date.now()
    })
    mockGetActorPerson.mockResolvedValue(null)

    const actor = await recordActorIfNeeded({ actorId, database })

    expect(actor?.id).toBe(actorId)

    // The failed sync stamps the marker, so the next call must not re-attempt
    // the remote fetch until the actor goes stale.
    mockGetActorPerson.mockClear()
    await expect(
      recordActorIfNeeded({ actorId, database })
    ).resolves.toMatchObject({ id: actorId })
    expect(mockGetActorPerson).not.toHaveBeenCalled()
  })

  it('refreshes the persisted actor type for stale remote actors', async () => {
    const sql = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(sql)
    await database.migrate()

    try {
      const actorId = 'https://remote-service.test/users/service'
      const oldTime = new Date(Date.now() - 4 * 86_400_000)
      await database.createActor({
        actorId,
        type: 'Person',
        username: 'service',
        domain: 'remote-service.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote-service.test/inbox',
        publicKey: 'old-public-key',
        createdAt: oldTime.getTime()
      })
      await sql('actors').where('id', actorId).update({ updatedAt: oldTime })

      mockGetActorPerson.mockResolvedValue({
        id: actorId,
        type: 'Service',
        preferredUsername: 'service',
        followers: `${actorId}/followers`,
        inbox: `${actorId}/inbox`,
        outbox: `${actorId}/outbox`,
        publicKey: {
          id: `${actorId}#main-key`,
          owner: actorId,
          publicKeyPem: 'new-public-key'
        },
        endpoints: {
          sharedInbox: 'https://remote-service.test/inbox'
        }
      })

      const actor = await recordActorIfNeeded({ actorId, database })

      expect(actor?.type).toBe('Service')
      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({
        type: 'Service',
        publicKey: 'new-public-key'
      })
    } finally {
      await database.destroy()
    }
  })

  it('returns undefined when a stale refresh cannot fetch the person', async () => {
    const sql = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(sql)
    await database.migrate()

    try {
      const actorId = 'https://remote-stale.test/users/gone'
      const oldTime = new Date(Date.now() - 4 * 86_400_000)
      await database.createActor({
        actorId,
        type: 'Person',
        username: 'gone',
        domain: 'remote-stale.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote-stale.test/inbox',
        publicKey: 'stale-public-key',
        createdAt: oldTime.getTime()
      })
      await sql('actors').where('id', actorId).update({ updatedAt: oldTime })

      mockGetActorPerson.mockResolvedValue(null)

      await expect(
        recordActorIfNeeded({ actorId, database })
      ).resolves.toBeUndefined()
    } finally {
      await database.destroy()
    }
  })
})

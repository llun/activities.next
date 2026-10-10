import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { FollowStatus } from '@/lib/types/domain/follow'

const testDb = createTestDatabase()
const { database } = testDb

const readDocument = (entityType: string, entityId: string) =>
  testDb.db
    .selectFrom('search_documents')
    .selectAll()
    .where('entityType', '=', entityType)
    .where('entityId', '=', entityId)
    .executeTakeFirst()

const entityIds = (documents: { entityId: string }[]) =>
  documents.map((document) => document.entityId)

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await database.destroy()
})

describe('upsertSearchDocument', () => {
  it('stores a document under <type>:<id> with whitespace-normalized text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1_700_000_000_000))

    await database.upsertSearchDocument({
      entityType: 'status',
      entityId: 'https://up.test/statuses/new',
      documentText: '  spaced \n  out\ttext ',
      actorId: 'https://up.test/users/author',
      visibility: 'unlisted',
      entityCreatedAt: 1_600_000_000_000,
      discoverable: false,
      postCount: 0,
      lastPostAt: 1_650_000_000_000
    })

    await expect(
      readDocument('status', 'https://up.test/statuses/new')
    ).resolves.toEqual({
      id: 'status:https://up.test/statuses/new',
      entityType: 'status',
      entityId: 'https://up.test/statuses/new',
      documentText: 'spaced out text',
      actorId: 'https://up.test/users/author',
      visibility: 'unlisted',
      entityCreatedAt: 1_600_000_000_000,
      discoverable: false,
      postCount: 0,
      lastPostAt: 1_650_000_000_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000
    })

    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'bare',
      documentText: 'bare'
    })
    await expect(readDocument('hashtag', 'bare')).resolves.toMatchObject({
      actorId: null,
      visibility: null,
      entityCreatedAt: null,
      discoverable: null,
      postCount: null,
      lastPostAt: null
    })
  })

  it('replaces every indexed field of the document it conflicts with and no other document', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const firstWrite = 1_700_000_000_000
    const secondWrite = 1_700_000_100_000
    const thirdWrite = 1_700_000_200_000
    const otherType = {
      entityType: 'status',
      entityId: 'replace-me',
      documentText: 'same entity id, other type',
      actorId: 'neighbour-actor',
      postCount: 7
    } as const
    const otherEntity = {
      entityType: 'hashtag',
      entityId: 'replace-me-too',
      documentText: 'same type, other entity id',
      actorId: 'neighbour-actor',
      postCount: 8
    } as const

    vi.setSystemTime(new Date(firstWrite))
    await database.upsertSearchDocument(otherType)
    await database.upsertSearchDocument(otherEntity)
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'replace-me',
      documentText: 'first text',
      actorId: 'first-actor',
      visibility: 'public',
      entityCreatedAt: 111,
      discoverable: true,
      postCount: 5,
      lastPostAt: 222
    })

    vi.setSystemTime(new Date(secondWrite))
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'replace-me',
      documentText: 'second text',
      actorId: 'second-actor',
      visibility: 'unlisted',
      entityCreatedAt: 333,
      discoverable: false,
      postCount: 0,
      lastPostAt: 444
    })
    await expect(readDocument('hashtag', 'replace-me')).resolves.toMatchObject({
      documentText: 'second text',
      actorId: 'second-actor',
      visibility: 'unlisted',
      entityCreatedAt: 333,
      discoverable: false,
      postCount: 0,
      lastPostAt: 444,
      createdAt: firstWrite,
      updatedAt: secondWrite
    })

    // A field the second write leaves out is cleared, not kept.
    vi.setSystemTime(new Date(thirdWrite))
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'replace-me',
      documentText: 'third text'
    })
    await expect(readDocument('hashtag', 'replace-me')).resolves.toMatchObject({
      documentText: 'third text',
      actorId: null,
      visibility: null,
      entityCreatedAt: null,
      discoverable: null,
      postCount: null,
      lastPostAt: null,
      createdAt: firstWrite,
      updatedAt: thirdWrite
    })

    await expect(readDocument('status', 'replace-me')).resolves.toMatchObject({
      documentText: 'same entity id, other type',
      actorId: 'neighbour-actor',
      postCount: 7,
      updatedAt: firstWrite
    })
    await expect(
      readDocument('hashtag', 'replace-me-too')
    ).resolves.toMatchObject({
      documentText: 'same type, other entity id',
      actorId: 'neighbour-actor',
      postCount: 8,
      updatedAt: firstWrite
    })
  })
})

describe('deleteSearchDocument', () => {
  it('deletes the document of that type and entity id and no other', async () => {
    for (const [entityType, entityId] of [
      ['hashtag', 'delete-me'],
      ['status', 'delete-me'],
      ['account', 'delete-me'],
      ['hashtag', 'delete-me-not']
    ] as const) {
      await database.upsertSearchDocument({
        entityType,
        entityId,
        documentText: 'to delete'
      })
    }

    await database.deleteSearchDocument({
      entityType: 'status',
      entityId: 'delete-me'
    })
    await expect(readDocument('status', 'delete-me')).resolves.toBeUndefined()
    await expect(readDocument('hashtag', 'delete-me')).resolves.toBeDefined()
    await expect(readDocument('account', 'delete-me')).resolves.toBeDefined()
    await expect(
      readDocument('hashtag', 'delete-me-not')
    ).resolves.toBeDefined()

    await database.deleteSearchDocument({
      entityType: 'hashtag',
      entityId: 'delete-me-not'
    })
    await expect(
      readDocument('hashtag', 'delete-me-not')
    ).resolves.toBeUndefined()
    await expect(readDocument('hashtag', 'delete-me')).resolves.toBeDefined()
  })
})

describe('searchDocuments text matching', () => {
  it('matches documents holding every query token as a word prefix', async () => {
    for (const [entityId, documentText] of [
      ['text-1', 'zqtrail running shoes'],
      ['text-2', 'zqtrail swimming'],
      ['text-3', 'xzqtrail running'],
      ['text-4', 'running only']
    ]) {
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId,
        documentText
      })
    }
    const search = async (q: string) =>
      entityIds(
        await database.searchDocuments({ entityType: 'hashtag', q, limit: 20 })
      ).sort()

    await expect(search('zqtrail')).resolves.toEqual(['text-1', 'text-2'])
    await expect(search('ZQTRAIL')).resolves.toEqual(['text-1', 'text-2'])
    await expect(search('zqtra')).resolves.toEqual(['text-1', 'text-2'])
    await expect(search('zqtrail runn')).resolves.toEqual(['text-1'])
    await expect(search('"zqtrail," (running)!')).resolves.toEqual(['text-1'])
    await expect(search('trail')).resolves.toEqual([])
  })

  it.each(['', '   ', '!!!', '@#%', '--'])(
    'finds nothing for a query without searchable tokens (%j)',
    async (q) => {
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: `tokenless-${q.length}`,
        documentText: 'tokenless zqtokenless'
      })

      await expect(
        database.searchDocuments({ entityType: 'hashtag', q, limit: 20 })
      ).resolves.toEqual([])
    }
  )
})

describe('searchDocuments ordering and paging', () => {
  // [entityId, postCount, lastPostAt, entityCreatedAt] inserted in an order
  // that is not the expected one.
  const rankedTail: [string, number | null, number | null, number | null][] = [
    ['t-a', 5, 100, 30],
    ['null-count', null, 999, 999],
    ['t-b', 5, 100, 30],
    ['p5-older', 5, 100, 40],
    ['p5-newer', 5, 100, 50],
    ['p10-null-last', 10, null, 99],
    ['p10-early', 10, 200, 9],
    ['p10-late', 10, 300, 5],
    ['p20', 20, null, null]
  ]

  beforeAll(async () => {
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'zqord',
      documentText: 'zqord',
      postCount: 1
    })
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'zqordering',
      documentText: 'zqordering zqord',
      postCount: null
    })
    for (const [
      entityId,
      postCount,
      lastPostAt,
      entityCreatedAt
    ] of rankedTail) {
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: `a-${entityId}`,
        documentText: 'zqord tail',
        postCount,
        lastPostAt,
        entityCreatedAt
      })
    }
  })

  const expectedOrder = [
    // Exact name, then name prefix, whatever their post counts.
    'zqord',
    'zqordering',
    // Then post count, last post, creation time and, last, entity id: each
    // descending with NULLs after every value.
    'a-p20',
    'a-p10-late',
    'a-p10-early',
    'a-p10-null-last',
    'a-p5-newer',
    'a-p5-older',
    'a-t-b',
    'a-t-a',
    'a-null-count'
  ]

  it.each(['#zqord', '@zqord', 'zqord', ' #ZQORD '])(
    'ranks hashtags by name match, then post count, last post, creation and entity id (%j)',
    async (q) => {
      const found = await database.searchDocuments({
        entityType: 'hashtag',
        q,
        limit: 50
      })

      expect(entityIds(found)).toEqual(expectedOrder)
    }
  )

  it('pages through the ranked results', async () => {
    const page = (offset: number, limit = 4) =>
      database
        .searchDocuments({ entityType: 'hashtag', q: 'zqord', limit, offset })
        .then(entityIds)

    await expect(page(0)).resolves.toEqual(expectedOrder.slice(0, 4))
    await expect(page(4)).resolves.toEqual(expectedOrder.slice(4, 8))
    await expect(page(8)).resolves.toEqual(expectedOrder.slice(8))
    await expect(page(12)).resolves.toEqual([])
    await expect(page(3, 2)).resolves.toEqual(expectedOrder.slice(3, 5))
  })

  it('returns the stored fields of each document', async () => {
    const [found] = await database.searchDocuments({
      entityType: 'hashtag',
      q: 'zqord',
      limit: 1,
      offset: 2
    })

    expect(found).toEqual({
      id: 'hashtag:a-p20',
      entityType: 'hashtag',
      entityId: 'a-p20',
      documentText: 'zqord tail',
      actorId: null,
      visibility: null,
      entityCreatedAt: null,
      discoverable: null,
      postCount: 20,
      lastPostAt: null,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number)
    })
  })
})

describe('searchDocuments visibility', () => {
  const HOST = 'https://vis.test'
  const viewer = `${HOST}/users/viewer`
  const otherViewer = `${HOST}/users/other-viewer`

  const insertActor = (id: string, settings: Record<string, unknown> | null) =>
    testDb.knex('actors').insert({
      id,
      type: 'Person',
      username: id.split('/').pop(),
      domain: 'vis.test',
      name: null,
      summary: null,
      accountId: null,
      settings: settings ? JSON.stringify(settings) : null,
      publicKey: 'public-key',
      privateKey: null,
      deletionStatus: null,
      deletionScheduledAt: null,
      createdAt: new Date(1),
      updatedAt: new Date(1)
    })

  const status = (name: string, author: string, visibility: string) =>
    database.upsertSearchDocument({
      entityType: 'status',
      entityId: `${HOST}/statuses/${name}`,
      documentText: 'zqvis status',
      actorId: author,
      visibility
    })

  const statusId = (name: string) => `${HOST}/statuses/${name}`
  let recipientCount = 0
  const addRecipient = (name: string, actorId: string) =>
    testDb.knex('recipients').insert({
      id: `vis-recipient-${(recipientCount += 1)}`,
      statusId: statusId(name),
      actorId,
      type: 'to'
    })
  let followCount = 0
  const addFollow = (
    actorId: string,
    targetActorId: string,
    followStatus: string
  ) =>
    testDb.knex('follows').insert({
      id: `vis-follow-${(followCount += 1)}`,
      actorId,
      actorHost: 'vis.test',
      targetActorId,
      targetActorHost: 'vis.test',
      status: followStatus
    })

  beforeAll(async () => {
    const accepted = FollowStatus.enum.Accepted
    const followedActor = `${HOST}/users/followed`
    await insertActor(followedActor, {
      followersUrl: `${HOST}/stored/followed-followers`
    })

    // Public, unlisted and the author's own.
    await status('public', `${HOST}/users/a`, 'public')
    await status('unlisted', `${HOST}/users/a`, 'unlisted')
    await status('self', viewer, 'private')
    await status('direct-visibility', `${HOST}/users/a`, 'direct')
    await status('other-private', `${HOST}/users/a`, 'private')

    // Addressed to the viewer; to someone else; and a status of nobody's
    // while the viewer is addressed on another one.
    await status('addressed', `${HOST}/users/a`, 'private')
    await addRecipient('addressed', viewer)
    await status('addressed-other', `${HOST}/users/a`, 'private')
    await addRecipient('addressed-other', otherViewer)
    await status('addressed-nothing', `${HOST}/users/a`, 'private')

    // Followers-only of an actor the viewer follows (accepted), through the
    // followers URL stored in the author's settings.
    await status('followers', followedActor, 'private')
    await addRecipient('followers', `${HOST}/stored/followed-followers`)
    await addFollow(viewer, followedActor, accepted)
    // ... another status of that author with no recipient row of its own.
    await status('followers-no-recipient', followedActor, 'private')
    // ... one whose audience is not the author's followers.
    await status('followers-wrong-audience', followedActor, 'private')
    await addRecipient('followers-wrong-audience', `${HOST}/not-followers`)

    // Followers-only of an author the viewer has only requested to follow.
    const requestedActor = `${HOST}/users/requested`
    await insertActor(requestedActor, { followersUrl: `${requestedActor}/f` })
    await status('followers-requested', requestedActor, 'private')
    await addRecipient('followers-requested', `${requestedActor}/f`)
    await addFollow(viewer, requestedActor, FollowStatus.enum.Requested)

    // Followed by somebody else, not by the viewer.
    const otherFollowed = `${HOST}/users/other-followed`
    await insertActor(otherFollowed, { followersUrl: `${otherFollowed}/f` })
    await status('followers-other-follower', otherFollowed, 'private')
    await addRecipient('followers-other-follower', `${otherFollowed}/f`)
    await addFollow(otherViewer, otherFollowed, accepted)

    // The viewer follows someone else, not the author.
    const notFollowed = `${HOST}/users/not-followed`
    await insertActor(notFollowed, { followersUrl: `${notFollowed}/f` })
    await status('followers-not-followed', notFollowed, 'private')
    await addRecipient('followers-not-followed', `${notFollowed}/f`)

    // An author without an actor row or stored URL: the audience is
    // `<author id>/followers`.
    const bareActor = `${HOST}/users/bare`
    await status('followers-fallback', bareActor, 'private')
    await addRecipient('followers-fallback', `${bareActor}/followers`)
    await addFollow(viewer, bareActor, accepted)
    const noUrlActor = `${HOST}/users/no-url`
    await insertActor(noUrlActor, {})
    await status('followers-fallback-settings', noUrlActor, 'private')
    await addRecipient('followers-fallback-settings', `${noUrlActor}/followers`)
    await addFollow(viewer, noUrlActor, accepted)

    // An author with no actor row, whose audience matches the stored followers
    // URL of ANOTHER actor.
    const strayActor = `${HOST}/users/stray`
    await status('followers-stray', strayActor, 'private')
    await addRecipient('followers-stray', `${HOST}/stored/followed-followers`)
    await addFollow(viewer, strayActor, accepted)

    // Accounts and hashtags.
    for (const [entityId, discoverable] of [
      [`${HOST}/users/shown`, true],
      [`${HOST}/users/hidden`, false]
    ] as const) {
      await database.upsertSearchDocument({
        entityType: 'account',
        entityId,
        documentText: 'zqvis account',
        actorId: entityId,
        discoverable
      })
    }
    await database.upsertSearchDocument({
      entityType: 'hashtag',
      entityId: 'zqvis',
      documentText: 'zqvis'
    })
    // Documents of one type carrying the other type's visibility fields.
    await database.upsertSearchDocument({
      entityType: 'status',
      entityId: `${HOST}/statuses/discoverable-status`,
      documentText: 'zqvis status',
      actorId: `${HOST}/users/a`,
      visibility: 'private',
      discoverable: true
    })
    await database.upsertSearchDocument({
      entityType: 'account',
      entityId: `${HOST}/users/public-account`,
      documentText: 'zqvis account',
      actorId: `${HOST}/users/public-account`,
      visibility: 'public',
      discoverable: false
    })
  })

  const visible = (names: string[]) =>
    names.map(statusId).sort((a, b) => a.localeCompare(b))
  const statusIdsFor = async (visibleToActorId?: string) =>
    entityIds(
      await database.searchDocuments({
        entityType: 'status',
        q: 'zqvis',
        limit: 100,
        visibleToActorId
      })
    ).sort((a, b) => a.localeCompare(b))

  it('shows an anonymous viewer only public and unlisted statuses', async () => {
    await expect(statusIdsFor()).resolves.toEqual(
      visible(['public', 'unlisted'])
    )
  })

  it('adds the viewer’s own statuses, the ones addressed to them and their followed actors’ followers-only ones', async () => {
    await expect(statusIdsFor(viewer)).resolves.toEqual(
      visible([
        'public',
        'unlisted',
        'self',
        'addressed',
        'followers',
        'followers-fallback',
        'followers-fallback-settings'
      ])
    )
  })

  it('shows another viewer only what concerns them', async () => {
    await expect(statusIdsFor(otherViewer)).resolves.toEqual(
      visible([
        'public',
        'unlisted',
        'addressed-other',
        'followers-other-follower'
      ])
    )
  })

  it('applies the account, status and hashtag rules to a search over every type', async () => {
    const search = async (options: {
      visibleToActorId?: string
      includeNonDiscoverable?: boolean
    }) =>
      entityIds(
        await database.searchDocuments({ q: 'zqvis', limit: 100, ...options })
      ).sort((a, b) => a.localeCompare(b))
    const accountsAndHashtag = [`${HOST}/users/shown`, 'zqvis']

    await expect(search({})).resolves.toEqual(
      [...accountsAndHashtag, ...visible(['public', 'unlisted'])].sort((a, b) =>
        a.localeCompare(b)
      )
    )
    await expect(search({ visibleToActorId: otherViewer })).resolves.toEqual(
      [
        ...accountsAndHashtag,
        ...visible([
          'public',
          'unlisted',
          'addressed-other',
          'followers-other-follower'
        ])
      ].sort((a, b) => a.localeCompare(b))
    )
    await expect(search({ includeNonDiscoverable: true })).resolves.toEqual(
      [
        ...accountsAndHashtag,
        `${HOST}/users/hidden`,
        `${HOST}/users/public-account`,
        ...visible(['public', 'unlisted'])
      ].sort((a, b) => a.localeCompare(b))
    )
  })

  it('filters accounts by discoverability alone', async () => {
    const search = async (includeNonDiscoverable?: boolean) =>
      entityIds(
        await database.searchDocuments({
          entityType: 'account',
          q: 'zqvis',
          limit: 100,
          visibleToActorId: viewer,
          includeNonDiscoverable
        })
      ).sort((a, b) => a.localeCompare(b))

    await expect(search()).resolves.toEqual([`${HOST}/users/shown`])
    await expect(search(true)).resolves.toEqual(
      [
        `${HOST}/users/hidden`,
        `${HOST}/users/public-account`,
        `${HOST}/users/shown`
      ].sort((a, b) => a.localeCompare(b))
    )
  })

  it('does not filter hashtags', async () => {
    await expect(
      database
        .searchDocuments({
          entityType: 'hashtag',
          q: 'zqvis',
          limit: 100,
          visibleToActorId: viewer
        })
        .then(entityIds)
    ).resolves.toEqual(['zqvis'])
  })
})

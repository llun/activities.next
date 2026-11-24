import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  type BlueskyAgent,
  BlueskySessionChangedError
} from '@/lib/services/bluesky/agent'
import {
  getPublicPosts,
  getPublicProfiles
} from '@/lib/services/bluesky/appview'
import { syncBlueskyNotifications } from '@/lib/services/bluesky/notifications'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { NotificationType } from '@/lib/types/database/operations'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicPosts: vi.fn(),
  getPublicProfiles: vi.fn()
}))

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => `https://${TEST_DOMAIN}`,
  getConfig: () => ({
    host: TEST_DOMAIN,
    serviceName: 'Activities',
    email: { serviceFromAddress: `noreply@${TEST_DOMAIN}` }
  })
}))

const did = (name: string) => `did:plc:${name.padEnd(24, 'a')}`
const USER_DID = did('reader')

const profileView = (
  name: string,
  overrides: Record<string, unknown> = {}
) => ({
  did: did(name),
  handle: `${name}.bsky.social`,
  displayName: name.toUpperCase(),
  description: `Bio of ${name}`,
  avatar: `https://cdn.bsky.app/${name}.jpg`,
  ...overrides
})

const postView = (
  name: string,
  rkey: string,
  {
    text = `post ${rkey}`,
    createdAt = '2026-01-01T00:00:00.000Z',
    reply,
    embed
  }: {
    text?: string
    createdAt?: string
    reply?: unknown
    embed?: unknown
  } = {}
) => ({
  uri: `at://${did(name)}/app.bsky.feed.post/${rkey}`,
  cid: `cid-${rkey}`,
  author: profileView(name),
  record: {
    $type: 'app.bsky.feed.post',
    text,
    createdAt,
    ...(reply ? { reply } : null),
    ...(embed ? { embed } : null)
  },
  indexedAt: createdAt
})

describe('syncBlueskyNotifications', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let actor: Actor
  const get = vi.fn()
  const agent: BlueskyAgent = {
    did: USER_DID,
    pdsUrl: 'https://pds.example.net/',
    get,
    post: vi.fn()
  }

  const appViewPosts = new Map<string, unknown>()
  const appViewProfiles = new Map<string, unknown>()

  const publishPost = (...views: { uri: string }[]) => {
    for (const view of views) appViewPosts.set(view.uri, view)
  }
  const publishProfile = (...views: { did: string }[]) => {
    for (const view of views) appViewProfiles.set(view.did, view)
  }

  const account = () => database.getBlueskyAccount({ actorId: actor.id })
  const notifications = () =>
    database.getNotifications({
      actorId: actor.id,
      includeFiltered: true,
      limit: 100
    })

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.createAccount({
      email: `reader@${TEST_DOMAIN}`,
      username: 'reader',
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: 'privateKey-reader',
      publicKey: 'publicKey-reader'
    })
    actor = (await database.getActorFromId({
      id: `https://${TEST_DOMAIN}/users/reader`
    })) as Actor
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did: USER_DID,
      handle: 'reader.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    get.mockReset()
    vi.mocked(sendNotificationAlerts).mockReset()
    appViewPosts.clear()
    appViewProfiles.clear()
    vi.mocked(getPublicPosts).mockImplementation(async (uris) =>
      uris.flatMap((uri) =>
        appViewPosts.has(uri) ? [appViewPosts.get(uri)] : []
      )
    )
    vi.mocked(getPublicProfiles).mockImplementation(async (dids) =>
      dids.flatMap((d) =>
        appViewProfiles.has(d) ? [appViewProfiles.get(d)] : []
      )
    )
    await testDb.db
      .deleteFrom('notifications')
      .where('actorId', '=', actor.id)
      .execute()
    await database.updateNotificationPolicy({
      actorId: actor.id,
      for_not_following: 'accept',
      for_not_followers: 'accept',
      for_new_accounts: 'accept',
      for_private_mentions: 'accept',
      for_limited_accounts: 'accept'
    })
  })

  it('on first run sets notificationsSeenAt to newest indexedAt (or now if empty) and creates nothing', async () => {
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: null
    })
    const olderAt = '2026-02-01T10:00:00.000Z'
    const newestAt = '2026-02-01T12:00:00.000Z'
    const myPost = postView('reader', 'p1')
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/l1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: newestAt
        },
        {
          uri: `at://${did('bob')}/app.bsky.feed.like/l2`,
          author: profileView('bob'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: olderAt
        }
      ],
      cursor: 'more'
    })

    await syncBlueskyNotifications(database, actor, agent)

    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(
      'app.bsky.notification.listNotifications',
      {
        limit: 50
      }
    )
    expect(getPublicPosts).not.toHaveBeenCalled()
    expect(getPublicProfiles).not.toHaveBeenCalled()
    expect(await notifications()).toEqual([])
    expect((await account())?.notificationsSeenAt).toBe(Date.parse(newestAt))

    // Also sets to now when there are no notifications at all.
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: null
    })
    get.mockResolvedValueOnce({ notifications: [] })
    const before = Date.now()
    await syncBlueskyNotifications(database, actor, agent)
    expect((await account())?.notificationsSeenAt).toBeGreaterThanOrEqual(
      before
    )
    expect(await notifications()).toEqual([])
  })

  it('creates like, reblog, reply, mention and quote notifications oldest-first with alerts and ignores follow', async () => {
    const t0 = Date.parse('2026-03-01T00:00:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })

    const myPost = postView('reader', 'own1', { text: 'my post' })
    const replyPost = postView('carol', 'r1', {
      text: 'nice!',
      reply: { root: { uri: myPost.uri }, parent: { uri: myPost.uri } }
    })
    const mentionPost = postView('dave', 'm1', { text: 'hey @reader' })
    const quotePost = postView('erin', 'q1', {
      text: 'quoting this',
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: myPost.uri, cid: myPost.cid }
      }
    })
    publishPost(myPost, replyPost, mentionPost, quotePost)
    publishProfile(
      profileView('alice'),
      profileView('bob'),
      profileView('carol'),
      profileView('dave'),
      profileView('erin'),
      profileView('frank')
    )

    // Newest first, as listNotifications returns them.
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: quotePost.uri,
          author: profileView('erin'),
          reason: 'quote',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-01T00:06:00.000Z'
        },
        {
          uri: `at://${did('frank')}/app.bsky.graph.follow/f1`,
          author: profileView('frank'),
          reason: 'follow',
          indexedAt: '2026-03-01T00:05:00.000Z'
        },
        {
          uri: mentionPost.uri,
          author: profileView('dave'),
          reason: 'mention',
          indexedAt: '2026-03-01T00:04:00.000Z'
        },
        {
          uri: replyPost.uri,
          author: profileView('carol'),
          reason: 'reply',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-01T00:03:00.000Z'
        },
        {
          uri: `at://${did('bob')}/app.bsky.feed.repost/rp1`,
          author: profileView('bob'),
          reason: 'repost',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-01T00:02:00.000Z'
        },
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/lk1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-01T00:01:00.000Z'
        },
        // Already seen: must not be created.
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/lk0`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-01T00:00:00.000Z'
        }
      ],
      cursor: 'should-not-follow'
    })

    await syncBlueskyNotifications(database, actor, agent)

    // Stopped paging when hitting seenAt.
    expect(get).toHaveBeenCalledTimes(1)

    const myPostStatusId = blueskyPostId(USER_DID, 'own1')
    const replyStatusId = blueskyPostId(did('carol'), 'r1')
    const mentionStatusId = blueskyPostId(did('dave'), 'm1')
    const quoteStatusId = blueskyPostId(did('erin'), 'q1')

    const rows = await notifications()
    expect(rows).toHaveLength(5)
    // Newest created is first in getNotifications.
    expect(
      rows.map((n) => ({
        type: n.type,
        sourceActorId: n.sourceActorId,
        statusId: n.statusId,
        groupKey: n.groupKey
      }))
    ).toEqual([
      {
        type: NotificationType.enum.quote,
        sourceActorId: blueskyActorId(did('erin')),
        statusId: quoteStatusId,
        groupKey: `quote:${myPostStatusId}`
      },
      {
        type: NotificationType.enum.mention,
        sourceActorId: blueskyActorId(did('dave')),
        statusId: mentionStatusId,
        groupKey: `mention:${mentionStatusId}`
      },
      {
        type: NotificationType.enum.reply,
        sourceActorId: blueskyActorId(did('carol')),
        statusId: replyStatusId,
        groupKey: `reply:${myPostStatusId}`
      },
      {
        type: NotificationType.enum.reblog,
        sourceActorId: blueskyActorId(did('bob')),
        statusId: myPostStatusId,
        groupKey: `reblog:${myPostStatusId}`
      },
      {
        type: NotificationType.enum.like,
        sourceActorId: blueskyActorId(did('alice')),
        statusId: myPostStatusId,
        groupKey: `like:${myPostStatusId}`
      }
    ])

    // Alerts dispatched oldest-first with emails for like/reblog/reply/mention and no email for quote.
    const alertCalls = vi.mocked(sendNotificationAlerts).mock.calls
    expect(alertCalls).toHaveLength(5)
    expect(alertCalls.map(([arg]) => arg.events[0].type)).toEqual([
      NotificationType.enum.like,
      NotificationType.enum.reblog,
      NotificationType.enum.reply,
      NotificationType.enum.mention,
      NotificationType.enum.quote
    ])
    expect(alertCalls[0][0].events[0].emailContent?.recipientEmail).toBe(
      `reader@${TEST_DOMAIN}`
    )
    expect(alertCalls[1][0].events[0].emailContent?.recipientEmail).toBe(
      `reader@${TEST_DOMAIN}`
    )
    expect(alertCalls[2][0].events[0].emailContent?.recipientEmail).toBe(
      `reader@${TEST_DOMAIN}`
    )
    expect(alertCalls[3][0].events[0].emailContent?.recipientEmail).toBe(
      `reader@${TEST_DOMAIN}`
    )
    expect(alertCalls[4][0].events[0].emailContent).toBeUndefined()

    expect((await account())?.notificationsSeenAt).toBe(
      Date.parse('2026-03-01T00:06:00.000Z')
    )
  })

  it('re-reads posts and profiles from the public AppView and validates author DIDs', async () => {
    const t0 = Date.parse('2026-03-02T00:00:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })

    const myPost = postView('reader', 'trust1', { text: 'real post' })
    const otherPost = postView('other', 'other1', { text: 'not my post' })
    const forgedReply = postView('realauthor', 'fr1', { text: 'real author' })
    const missingAuthorPost = postView('ghost', 'g1', { text: 'ghost' })
    publishPost(myPost, otherPost, forgedReply, missingAuthorPost)
    // Only alice and bob are returned by AppView profiles (ghost is missing).
    publishProfile(
      profileView('alice', { displayName: 'Real Alice' }),
      profileView('bob', { displayName: 'Real Bob' })
    )

    get.mockResolvedValueOnce({
      notifications: [
        // Valid like, but PDS lies about author displayName.
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/v1`,
          author: { ...profileView('alice'), displayName: 'Forged Alice' },
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-02T00:05:00.000Z'
        },
        // Like whose subject post belongs to someone else (not user's linked DID).
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/bad1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: otherPost.uri,
          indexedAt: '2026-03-02T00:04:00.000Z'
        },
        // Reply whose post author DID !== notification author DID.
        {
          uri: forgedReply.uri,
          author: profileView('bob'),
          reason: 'reply',
          indexedAt: '2026-03-02T00:03:00.000Z'
        },
        // Mention whose author the AppView does not return.
        {
          uri: missingAuthorPost.uri,
          author: profileView('ghost'),
          reason: 'mention',
          indexedAt: '2026-03-02T00:02:00.000Z'
        },
        // Like whose post the AppView does not return.
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/missing`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: `at://${USER_DID}/app.bsky.feed.post/deleted`,
          indexedAt: '2026-03-02T00:01:00.000Z'
        }
      ]
    })

    await syncBlueskyNotifications(database, actor, agent)

    const rows = await notifications()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: NotificationType.enum.like,
      sourceActorId: blueskyActorId(did('alice')),
      statusId: blueskyPostId(USER_DID, 'trust1')
    })
    // Stored actor came from the AppView, not the forged PDS payload.
    const storedAlice = await database.getActorFromId({
      id: blueskyActorId(did('alice'))
    })
    expect(storedAlice?.name).toBe('Real Alice')
    // Ghost was never stored.
    expect(
      await database.getActorFromId({ id: blueskyActorId(did('ghost')) })
    ).toBeNull()
  })

  it('deduplicates when re-processing the same notification after a crash before seenAt advanced', async () => {
    const t0 = Date.parse('2026-03-03T00:00:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })
    const myPost = postView('reader', 'dup1')
    publishPost(myPost)
    publishProfile(profileView('alice'))

    const page = {
      notifications: [
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/d1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-03T00:01:00.000Z'
        }
      ]
    }
    get.mockResolvedValue(page)

    await syncBlueskyNotifications(database, actor, agent)
    expect(await notifications()).toHaveLength(1)
    expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)

    // Simulate seenAt not having been persisted before a crash.
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })

    await syncBlueskyNotifications(database, actor, agent)
    expect(await notifications()).toHaveLength(1)
    expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
  })

  it('respects notification policy (filter suppresses alerts, drop creates nothing)', async () => {
    const t0 = Date.parse('2026-03-04T00:00:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })
    await database.updateNotificationPolicy({
      actorId: actor.id,
      for_not_following: 'filter'
    })

    const myPost = postView('reader', 'pol1')
    publishPost(myPost)
    publishProfile(profileView('stranger'))
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: `at://${did('stranger')}/app.bsky.feed.like/p1`,
          author: profileView('stranger'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-04T00:01:00.000Z'
        }
      ]
    })

    await syncBlueskyNotifications(database, actor, agent)

    const rows = await notifications()
    expect(rows).toHaveLength(1)
    expect(rows[0].filtered).toBe(true)
    expect(sendNotificationAlerts).not.toHaveBeenCalled()

    // Re-running with reset seenAt also deduplicates filtered rows.
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: `at://${did('stranger')}/app.bsky.feed.like/p1`,
          author: profileView('stranger'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: '2026-03-04T00:01:00.000Z'
        }
      ]
    })
    await syncBlueskyNotifications(database, actor, agent)
    expect(await notifications()).toHaveLength(1)
  })

  it('reads at most 2 pages via cursor', async () => {
    const t0 = Date.parse('2026-03-05T00:00:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })
    const myPost = postView('reader', 'page1')
    publishPost(myPost)
    publishProfile(profileView('alice'), profileView('bob'))

    get
      .mockResolvedValueOnce({
        notifications: [
          {
            uri: `at://${did('alice')}/app.bsky.feed.like/pg1`,
            author: profileView('alice'),
            reason: 'like',
            reasonSubject: myPost.uri,
            indexedAt: '2026-03-05T00:02:00.000Z'
          }
        ],
        cursor: 'c1'
      })
      .mockResolvedValueOnce({
        notifications: [
          {
            uri: `at://${did('bob')}/app.bsky.feed.like/pg2`,
            author: profileView('bob'),
            reason: 'like',
            reasonSubject: myPost.uri,
            indexedAt: '2026-03-05T00:01:00.000Z'
          }
        ],
        cursor: 'c2'
      })

    await syncBlueskyNotifications(database, actor, agent)

    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith(
      'app.bsky.notification.listNotifications',
      { limit: 50, cursor: 'c1' }
    )
    expect(await notifications()).toHaveLength(2)
  })

  it('does nothing when federation policy disallows Bluesky', async () => {
    const block = await database.createDomainBlock({
      domain: 'bsky.app',
      severity: 'suspend'
    })
    try {
      await syncBlueskyNotifications(database, actor, agent)
    } finally {
      await database.deleteDomainBlock(block.id)
    }
    expect(get).not.toHaveBeenCalled()
  })

  it('throws BlueskySessionChangedError if the actor relinked to another DID', async () => {
    const otherAgent: BlueskyAgent = {
      ...agent,
      did: did('different')
    }
    await expect(
      syncBlueskyNotifications(database, actor, otherAgent)
    ).rejects.toBeInstanceOf(BlueskySessionChangedError)
    expect(get).not.toHaveBeenCalled()
  })
})

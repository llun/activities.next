import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  type BlueskyAgent,
  BlueskySessionChangedError
} from '@/lib/services/bluesky/agent'
import {
  getPublicPosts,
  getPublicProfiles
} from '@/lib/services/bluesky/appview'
import {
  BLUESKY_NOTIFICATION_ATTEMPTS,
  syncBlueskyNotifications
} from '@/lib/services/bluesky/notifications'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { NotificationType } from '@/lib/types/database/operations'
import type { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

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
    embed,
    facets
  }: {
    text?: string
    createdAt?: string
    reply?: unknown
    embed?: unknown
    facets?: unknown
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
    ...(embed ? { embed } : null),
    ...(facets ? { facets } : null)
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
    post: vi.fn(),
    uploadBlob: vi.fn()
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

  it('on first run uses account link time as watermark: keeps post-link notifications and ignores older ones', async () => {
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: null
    })
    const linkedAt = (await account())?.createdAt as number
    const beforeLink = new Date(linkedAt - 60_000).toISOString()
    const afterLink = new Date(linkedAt + 60_000).toISOString()
    const myPost = postView('reader', 'p1')
    publishPost(myPost)
    publishProfile(profileView('alice'), profileView('bob'))

    // Notification older than link time only: creates nothing and sets seenAt to link time.
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: `at://${did('bob')}/app.bsky.feed.like/l-old`,
          author: profileView('bob'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: beforeLink
        }
      ],
      cursor: 'more'
    })

    await syncBlueskyNotifications(database, actor, agent)

    expect(get).toHaveBeenCalledTimes(1)
    expect(getPublicPosts).not.toHaveBeenCalled()
    expect(getPublicProfiles).not.toHaveBeenCalled()
    expect(await notifications()).toEqual([])
    expect((await account())?.notificationsSeenAt).toBe(linkedAt)

    // When a notification arrived after linking (e.g. while initial Home syncs failed),
    // the first successful run still delivers it and skips older ones.
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: null
    })
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/l-new`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: afterLink
        },
        {
          uri: `at://${did('bob')}/app.bsky.feed.like/l-old2`,
          author: profileView('bob'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: beforeLink
        }
      ]
    })

    await syncBlueskyNotifications(database, actor, agent)

    const rows = await notifications()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: NotificationType.enum.like,
      sourceActorId: blueskyActorId(did('alice'))
    })
    expect((await account())?.notificationsSeenAt).toBe(Date.parse(afterLink))
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
    const mentionPost = postView('dave', 'm1', {
      text: 'hey @reader',
      facets: [
        {
          index: { byteStart: 4, byteEnd: 11 },
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: USER_DID }
          ]
        }
      ]
    })
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

  it("puts likes, reposts, replies and quotes of the user's cross-post on the local post", async () => {
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: Date.parse('2026-04-01T00:00:00.000Z')
    })
    const localId = `${actor.id}/statuses/crossposted`
    await database.createNote({
      id: localId,
      url: localId,
      actorId: actor.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Posted here and on Bluesky'
    })
    const copy = postView('reader', 'copy1', { text: 'Posted here' })
    await database.claimBlueskyCrosspost({
      statusId: localId,
      actorId: actor.id
    })
    await database.markBlueskyCrosspostPosted({
      statusId: localId,
      uri: copy.uri,
      cid: copy.cid
    })
    const replyPost = postView('carol', 'cr1', {
      reply: { root: { uri: copy.uri }, parent: { uri: copy.uri } }
    })
    const quotePost = postView('erin', 'cq1', {
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: copy.uri, cid: copy.cid }
      }
    })
    publishPost(copy, replyPost, quotePost)
    publishProfile(
      profileView('alice'),
      profileView('bob'),
      profileView('carol'),
      profileView('erin')
    )
    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: quotePost.uri,
          author: profileView('erin'),
          reason: 'quote',
          reasonSubject: copy.uri,
          indexedAt: '2026-04-01T00:04:00.000Z'
        },
        {
          uri: replyPost.uri,
          author: profileView('carol'),
          reason: 'reply',
          reasonSubject: copy.uri,
          indexedAt: '2026-04-01T00:03:00.000Z'
        },
        {
          uri: `at://${did('bob')}/app.bsky.feed.repost/crp1`,
          author: profileView('bob'),
          reason: 'repost',
          reasonSubject: copy.uri,
          indexedAt: '2026-04-01T00:02:00.000Z'
        },
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/clk1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: copy.uri,
          indexedAt: '2026-04-01T00:01:00.000Z'
        }
      ]
    })

    await syncBlueskyNotifications(database, actor, agent)

    const replyId = blueskyPostId(did('carol'), 'cr1')
    const quoteId = blueskyPostId(did('erin'), 'cq1')
    expect(
      (await notifications()).map((n) => ({
        type: n.type,
        statusId: n.statusId,
        groupKey: n.groupKey
      }))
    ).toEqual([
      {
        type: NotificationType.enum.quote,
        statusId: quoteId,
        groupKey: `quote:${localId}`
      },
      {
        type: NotificationType.enum.reply,
        statusId: replyId,
        groupKey: `reply:${localId}`
      },
      {
        type: NotificationType.enum.reblog,
        statusId: localId,
        groupKey: `reblog:${localId}`
      },
      {
        type: NotificationType.enum.like,
        statusId: localId,
        groupKey: `like:${localId}`
      }
    ])
    // The copy itself is never stored as a second, Bluesky status.
    await expect(
      database.getBlueskyRecordByUri({ uri: copy.uri })
    ).resolves.toBeNull()
    await expect(
      database.getStatus({ statusId: replyId, withReplies: false })
    ).resolves.toMatchObject({ reply: localId })
  })

  it('verifies reply, mention, and quote targets on the AppView post and skips spoofed ones', async () => {
    const t0 = Date.parse('2026-03-04T12:00:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })
    const myPost = postView('reader', 'verify1')
    const someoneElsesPost = postView('other', 'otherpost1')

    // Valid reply via root.uri (parent belongs to someone else, root belongs to user).
    const validRootReply = postView('carol', 'vr1', {
      reply: {
        root: { uri: myPost.uri },
        parent: { uri: someoneElsesPost.uri }
      }
    })
    // Spoofed reply: neither parent nor root is in user's repo.
    const spoofedReply = postView('carol', 'sr1', {
      reply: {
        root: { uri: someoneElsesPost.uri },
        parent: { uri: someoneElsesPost.uri }
      }
    })
    // Spoofed mention: no mention facet for USER_DID (only mentions someone else).
    const spoofedMention = postView('dave', 'sm1', {
      text: 'hi @other',
      facets: [
        {
          index: { byteStart: 3, byteEnd: 9 },
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: did('other') }
          ]
        }
      ]
    })
    // Valid quote via recordWithMedia.
    const validMediaQuote = postView('erin', 'vq1', {
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        record: {
          record: { uri: myPost.uri, cid: myPost.cid }
        },
        media: { $type: 'app.bsky.embed.images', images: [] }
      }
    })
    // Spoofed quote: embed references someone else's post.
    const spoofedQuote = postView('erin', 'sq1', {
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: someoneElsesPost.uri, cid: someoneElsesPost.cid }
      }
    })
    publishPost(
      validRootReply,
      spoofedReply,
      spoofedMention,
      validMediaQuote,
      spoofedQuote
    )
    publishProfile(
      profileView('carol'),
      profileView('dave'),
      profileView('erin')
    )

    get.mockResolvedValueOnce({
      notifications: [
        {
          uri: spoofedQuote.uri,
          author: profileView('erin'),
          reason: 'quote',
          indexedAt: '2026-03-04T12:05:00.000Z'
        },
        {
          uri: validMediaQuote.uri,
          author: profileView('erin'),
          reason: 'quote',
          indexedAt: '2026-03-04T12:04:00.000Z'
        },
        {
          uri: spoofedMention.uri,
          author: profileView('dave'),
          reason: 'mention',
          indexedAt: '2026-03-04T12:03:00.000Z'
        },
        {
          uri: spoofedReply.uri,
          author: profileView('carol'),
          reason: 'reply',
          indexedAt: '2026-03-04T12:02:00.000Z'
        },
        {
          uri: validRootReply.uri,
          author: profileView('carol'),
          reason: 'reply',
          indexedAt: '2026-03-04T12:01:00.000Z'
        }
      ]
    })

    await syncBlueskyNotifications(database, actor, agent)

    const rows = await notifications()
    expect(rows.map((n) => ({ type: n.type, statusId: n.statusId }))).toEqual([
      {
        type: NotificationType.enum.quote,
        statusId: blueskyPostId(did('erin'), 'vq1')
      },
      {
        type: NotificationType.enum.reply,
        statusId: blueskyPostId(did('carol'), 'vr1')
      }
    ])
  })

  it('reads at most 4 pages via cursor and logs info when the cap is hit before reaching seenAt', async () => {
    const infoSpy = vi.spyOn(logger, 'info')
    try {
      const t0 = Date.parse('2026-03-05T00:00:00.000Z')
      await database.updateBlueskyNotificationsSeenAt({
        actorId: actor.id,
        seenAt: t0
      })
      const myPost = postView('reader', 'page1')
      publishPost(myPost)
      publishProfile(
        profileView('alice'),
        profileView('bob'),
        profileView('carol'),
        profileView('dave')
      )

      const pageActors = ['alice', 'bob', 'carol', 'dave']
      for (const [index, name] of pageActors.entries()) {
        get.mockResolvedValueOnce({
          notifications: [
            {
              uri: `at://${did(name)}/app.bsky.feed.like/pg${index + 1}`,
              author: profileView(name),
              reason: 'like',
              reasonSubject: myPost.uri,
              indexedAt: new Date(
                t0 + (pageActors.length - index) * 60_000
              ).toISOString()
            }
          ],
          cursor: `c${index + 1}`
        })
      }

      await syncBlueskyNotifications(database, actor, agent)

      expect(get).toHaveBeenCalledTimes(4)
      expect(get).toHaveBeenLastCalledWith(
        'app.bsky.notification.listNotifications',
        { limit: 50, cursor: 'c3' }
      )
      expect(await notifications()).toHaveLength(4)
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: actor.id,
          pages: 4,
          readCount: 4
        })
      )
    } finally {
      infoSpy.mockRestore()
    }
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

  it('stops before a notification that failed to store, so the next run retries it and the later ones once', async () => {
    const t0 = Date.parse('2026-03-06T00:00:00.000Z')
    const t1 = Date.parse('2026-03-06T00:01:00.000Z')
    const t2 = Date.parse('2026-03-06T00:02:00.000Z')
    const t3 = Date.parse('2026-03-06T00:03:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })

    const myPost = postView('reader', 'retry1')
    publishPost(myPost)
    publishProfile(
      profileView('alice'),
      profileView('bob'),
      profileView('carol')
    )

    const page = {
      notifications: [
        {
          uri: `at://${did('carol')}/app.bsky.feed.like/r3`,
          author: profileView('carol'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: new Date(t3).toISOString()
        },
        {
          uri: `at://${did('bob')}/app.bsky.feed.like/r2`,
          author: profileView('bob'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: new Date(t2).toISOString()
        },
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/r1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: new Date(t1).toISOString()
        }
      ]
    }
    get.mockResolvedValue(page)

    const originalCreateNotification =
      database.createNotification.bind(database)
    const createSpy = vi
      .spyOn(database, 'createNotification')
      .mockImplementation(async (params) => {
        if (params.sourceActorId === blueskyActorId(did('bob'))) {
          throw new Error('connection reset')
        }
        return originalCreateNotification(params)
      })

    try {
      await expect(
        syncBlueskyNotifications(database, actor, agent)
      ).rejects.toThrow('connection reset')
    } finally {
      createSpy.mockRestore()
    }

    // 1st notification was created, seenAt advanced to t1 (before the failed 2nd).
    const afterFirstRun = await notifications()
    expect(afterFirstRun).toHaveLength(1)
    expect(afterFirstRun[0].sourceActorId).toBe(blueskyActorId(did('alice')))
    expect((await account())?.notificationsSeenAt).toBe(t1)

    // Next run succeeds and creates the 2nd and 3rd once, without duplicating the 1st.
    await syncBlueskyNotifications(database, actor, agent)

    const afterSecondRun = await notifications()
    expect(afterSecondRun).toHaveLength(3)
    expect(afterSecondRun.map((n) => n.sourceActorId)).toEqual([
      blueskyActorId(did('carol')),
      blueskyActorId(did('bob')),
      blueskyActorId(did('alice'))
    ])
    expect((await account())?.notificationsSeenAt).toBe(t3)
    expect(sendNotificationAlerts).toHaveBeenCalledTimes(3)
  })

  it('skips a notification that cannot be stored instead of blocking the later ones', async () => {
    const t0 = Date.parse('2026-03-06T00:00:00.000Z')
    const t1 = Date.parse('2026-03-06T00:01:00.000Z')
    const t2 = Date.parse('2026-03-06T00:02:00.000Z')
    const t3 = Date.parse('2026-03-06T00:03:00.000Z')
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: t0
    })

    const myPost = postView('reader', 'skip1')
    publishPost(myPost)
    publishProfile(
      profileView('alice'),
      profileView('bob'),
      profileView('carol')
    )

    const page = {
      notifications: [
        {
          uri: `at://${did('carol')}/app.bsky.feed.like/r3`,
          author: profileView('carol'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: new Date(t3).toISOString()
        },
        {
          uri: `at://${did('bob')}/app.bsky.feed.like/r2`,
          author: profileView('bob'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: new Date(t2).toISOString()
        },
        {
          uri: `at://${did('alice')}/app.bsky.feed.like/r1`,
          author: profileView('alice'),
          reason: 'like',
          reasonSubject: myPost.uri,
          indexedAt: new Date(t1).toISOString()
        }
      ]
    }
    get.mockResolvedValue(page)

    const originalCreateNotification =
      database.createNotification.bind(database)
    const createSpy = vi
      .spyOn(database, 'createNotification')
      .mockImplementation(async (params) => {
        if (params.sourceActorId === blueskyActorId(did('bob'))) {
          throw new Error('transient DB write failure')
        }
        return originalCreateNotification(params)
      })

    try {
      // Retried on the next syncs, then skipped once it used up its tries.
      for (let run = 1; run < BLUESKY_NOTIFICATION_ATTEMPTS.limit; run++) {
        await expect(
          syncBlueskyNotifications(database, actor, agent)
        ).rejects.toThrow('transient DB write failure')
      }
      await syncBlueskyNotifications(database, actor, agent)
    } finally {
      createSpy.mockRestore()
    }

    const after = await notifications()
    expect(after.map((n) => n.sourceActorId)).toEqual([
      blueskyActorId(did('carol')),
      blueskyActorId(did('alice'))
    ])
    expect((await account())?.notificationsSeenAt).toBe(t3)
  })
})

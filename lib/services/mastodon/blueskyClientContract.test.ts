/** @vitest-size medium */
import { NextRequest } from 'next/server'

import { GET as getAccount } from '@/app/api/v1/accounts/[id]/route'
import { GET as getAccountStatuses } from '@/app/api/v1/accounts/[id]/statuses/route'
import { GET as getStatusContext } from '@/app/api/v1/statuses/[id]/context/route'
import { GET as getStatus } from '@/app/api/v1/statuses/[id]/route'
import { GET as getStatusSource } from '@/app/api/v1/statuses/[id]/source/route'
import { GET as getTimeline } from '@/app/api/v1/timelines/[timeline]/route'
import { GET as getNotificationsV2 } from '@/app/api/v2/notifications/route'
import { GET as searchV2 } from '@/app/api/v2/search/route'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  getPublicAuthorFeed,
  getPublicPostThread,
  getPublicProfile
} from '@/lib/services/bluesky/appview'
import {
  blueskyActorId,
  blueskyPostId,
  blueskyPostToHtml
} from '@/lib/services/bluesky/records'
import {
  getMastodonStatus,
  getMastodonStatuses
} from '@/lib/services/mastodon/getMastodonStatus'
import { Timeline } from '@/lib/services/timelines/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Status } from '@/lib/types/domain/status'
import * as Mastodon from '@/lib/types/mastodon'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

vi.mock('@/lib/services/bluesky/appview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bluesky/appview')>()),
  getPublicAuthorFeed: vi.fn().mockResolvedValue({ feed: [] }),
  getPublicPostThread: vi.fn().mockResolvedValue({ thread: null }),
  getPublicProfile: vi.fn().mockResolvedValue(null)
}))

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const assertAbsoluteHttpsUrl = (value: unknown) => {
  expect(typeof value).toBe('string')
  const parsed = new URL(value as string)
  expect(parsed.protocol).toBe('https:')
}

const assertCleanJson = (payload: unknown) => {
  const serialized = JSON.stringify(payload)
  expect(serialized).not.toContain('undefined')
  expect(serialized).not.toContain('"0x0"')
}

const assertBlueskyAccountContract = (raw: unknown) => {
  assertCleanJson(raw)
  const account = Mastodon.Account.parse(raw)
  expect(account.id.length).toBeGreaterThan(0)
  assertAbsoluteHttpsUrl(account.url)
  if (account.uri) assertAbsoluteHttpsUrl(account.uri)
  expect(account.created_at).toMatch(ISO_8601_UTC)
  expect(account.acct.endsWith('@bsky.app')).toBe(true)
  return account
}

const assertBlueskyStatusContract = (
  raw: unknown,
  { expectBoostWrapper = false }: { expectBoostWrapper?: boolean } = {}
) => {
  assertCleanJson(raw)
  const status = Mastodon.Status.parse(raw)
  expect(status.id.length).toBeGreaterThan(0)
  assertAbsoluteHttpsUrl(status.uri)
  assertAbsoluteHttpsUrl(status.url)
  expect(status.created_at).toMatch(ISO_8601_UTC)

  const target = expectBoostWrapper ? status.reblog : status
  expect(target).not.toBeNull()
  if (!target) throw new Error('Expected status target')

  expect(target.id.length).toBeGreaterThan(0)
  assertAbsoluteHttpsUrl(target.uri)
  assertAbsoluteHttpsUrl(target.url)
  expect(target.created_at).toMatch(ISO_8601_UTC)
  expect(target.edited_at).toBeNull()
  expect(target.quote_approval).toEqual({
    automatic: [],
    manual: [],
    current_user: 'denied'
  })
  assertBlueskyAccountContract(target.account)

  for (const attachment of target.media_attachments) {
    const parsedAttachment = Mastodon.MediaAttachment.parse(attachment)
    expect(parsedAttachment.id.length).toBeGreaterThan(0)
    assertAbsoluteHttpsUrl(parsedAttachment.url)
    if (parsedAttachment.type === 'image') {
      assertAbsoluteHttpsUrl(parsedAttachment.preview_url)
    }
    if ('meta' in parsedAttachment && parsedAttachment.meta) {
      const metaJson = JSON.stringify(parsedAttachment.meta)
      expect(metaJson).not.toContain('undefined')
      expect(metaJson).not.toContain('0x0')
    }
  }

  return status
}

describe('Bluesky Mastodon client API contract', () => {
  const { database, prepare } = createTestDatabase()

  const AUTHOR_DID = `did:plc:${'a'.repeat(24)}`
  const AUTHOR_HANDLE = 'contractsky.bsky.social'
  const REPLIER_DID = `did:plc:${'b'.repeat(24)}`
  const REPLIER_HANDLE = 'repliersky.bsky.social'
  const VIEWER_DID = `did:plc:${'v'.repeat(24)}`

  let authorActorId: string
  let replierActorId: string
  let bskyPostId: string
  let bskyReplyId: string
  let localBoostId: string
  let localOlderPostId: string
  let localNewerPostId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    await database.saveBlueskyAccount({
      actorId: ACTOR1_ID,
      did: VIEWER_DID,
      handle: 'viewer.bsky.social',
      pdsUrl: 'https://bsky.social',
      authType: 'oauth',
      domainHandle: false
    })

    authorActorId = (await database.upsertBlueskyActor({
      did: AUTHOR_DID,
      handle: AUTHOR_HANDLE,
      name: 'Contract Sky',
      summary: 'Testing strict Mastodon client decoding',
      iconUrl: 'https://cdn.bsky.app/img/avatar/plain/did:plc:aaa/avatar@jpeg',
      headerImageUrl:
        'https://cdn.bsky.app/img/banner/plain/did:plc:aaa/banner@jpeg',
      followersCount: 12,
      followingCount: 5,
      postsCount: 3
    })) as string

    replierActorId = (await database.upsertBlueskyActor({
      did: REPLIER_DID,
      handle: REPLIER_HANDLE,
      name: 'Replier Sky',
      iconUrl: 'https://cdn.bsky.app/img/avatar/plain/did:plc:bbb/avatar@jpeg'
    })) as string

    const baseTime = Date.now() + 60_000

    const localOlder = await database.createNote({
      id: `${ACTOR1_ID}/statuses/contract-local-older`,
      url: `${ACTOR1_ID}/statuses/contract-local-older`,
      actorId: ACTOR1_ID,
      text: 'Older local post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: baseTime + 1_000
    })
    localOlderPostId = localOlder.id

    const postText = 'Check out this link:\nexample.com/article'
    const linkStart = Buffer.byteLength('Check out this link:\n')
    const linkEnd = linkStart + Buffer.byteLength('example.com/article')
    const postHtml = blueskyPostToHtml(postText, [
      {
        index: { byteStart: linkStart, byteEnd: linkEnd },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/article'
          }
        ]
      }
    ])

    const postRecord = await database.upsertBlueskyPost({
      uri: `at://${AUTHOR_DID}/app.bsky.feed.post/contract1`,
      cid: 'cid-contract1',
      did: AUTHOR_DID,
      rkey: 'contract1',
      actorId: authorActorId,
      text: postHtml,
      createdAt: baseTime + 2_000,
      attachments: [
        {
          url: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:aaa/img1@jpeg',
          thumbnailUrl: null,
          mediaType: 'image/jpeg',
          description: 'Photo without aspect ratio'
        }
      ]
    })
    bskyPostId = postRecord.statusId

    const replyRecord = await database.upsertBlueskyPost({
      uri: `at://${REPLIER_DID}/app.bsky.feed.post/contractreply1`,
      cid: 'cid-contractreply1',
      did: REPLIER_DID,
      rkey: 'contractreply1',
      actorId: replierActorId,
      text: '<p>A Bluesky reply</p>',
      replyToStatusId: bskyPostId,
      createdAt: baseTime + 3_000,
      attachments: []
    })
    bskyReplyId = replyRecord.statusId

    const boost = await database.createAnnounce({
      id: `${ACTOR1_ID}/statuses/contract-local-boost`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: bskyPostId,
      createdAt: baseTime + 4_000
    })
    if (!boost) throw new Error('Expected local boost of Bluesky post')
    localBoostId = boost.id

    const localNewer = await database.createNote({
      id: `${ACTOR1_ID}/statuses/contract-local-newer`,
      url: `${ACTOR1_ID}/statuses/contract-local-newer`,
      actorId: ACTOR1_ID,
      text: 'Newer local post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: baseTime + 5_000
    })
    localNewerPostId = localNewer.id

    // Seed mixed Home timeline entries for ACTOR1 with explicit ordering.
    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: localOlder,
      timeline: Timeline.MAIN,
      createdAt: baseTime + 1_000
    })
    const bskyPostDomain = (await database.getStatus({
      statusId: bskyPostId
    })) as Status
    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: bskyPostDomain,
      timeline: Timeline.MAIN,
      createdAt: baseTime + 2_000
    })
    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: boost,
      timeline: Timeline.MAIN,
      createdAt: baseTime + 4_000
    })
    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: localNewer,
      timeline: Timeline.MAIN,
      createdAt: baseTime + 5_000
    })

    // Seed Bluesky notifications: like, repost (reblog), reply, follow.
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'like',
      sourceActorId: authorActorId,
      statusId: localNewerPostId,
      groupKey: `like:${localNewerPostId}`
    })
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'reblog',
      sourceActorId: replierActorId,
      statusId: localNewerPostId,
      groupKey: `reblog:${localNewerPostId}`
    })
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'reply',
      sourceActorId: replierActorId,
      statusId: bskyReplyId,
      groupKey: `reply:${bskyReplyId}`
    })
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'follow',
      sourceActorId: authorActorId,
      groupKey: `follow:${authorActorId}`
    })
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    vi.mocked(getPublicAuthorFeed).mockResolvedValue({ feed: [] })
    vi.mocked(getPublicPostThread).mockResolvedValue({ thread: null })
    vi.mocked(getPublicProfile).mockResolvedValue(null)
  })

  it('serializes Bluesky statuses, replies, and local boosts cleanly through the real serializers', async () => {
    const post = (await database.getStatus({ statusId: bskyPostId })) as Status
    const reply = (await database.getStatus({
      statusId: bskyReplyId
    })) as Status
    const boost = (await database.getStatus({
      statusId: localBoostId
    })) as Status

    const serializedPost = await getMastodonStatus(database, post, ACTOR1_ID)
    const checkedPost = assertBlueskyStatusContract(serializedPost)
    expect(checkedPost.media_attachments).toHaveLength(1)
    const image = checkedPost.media_attachments[0]
    expect(image.type).toBe('image')
    expect(image.preview_url).toBe(image.url)
    expect('meta' in image ? image.meta : undefined).toBeUndefined()
    expect(checkedPost.text).toBe(
      'Check out this link:\nhttps://example.com/article'
    )

    const batch = await getMastodonStatuses(
      database,
      [post, reply, boost],
      ACTOR1_ID
    )
    expect(batch).toHaveLength(3)
    assertBlueskyStatusContract(batch[0])
    const checkedReply = assertBlueskyStatusContract(batch[1])
    expect(checkedReply.in_reply_to_id).toBe(checkedPost.id)
    expect(checkedReply.in_reply_to_account_id).toBe(checkedPost.account.id)
    assertBlueskyStatusContract(batch[2], { expectBoostWrapper: true })
  })

  it('satisfies strict client contract on GET /api/v1/statuses/:id, /context, and /source', async () => {
    const postResponse = await getStatus(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(bskyPostId)}`
      ),
      { params: Promise.resolve({ id: urlToId(bskyPostId) }) }
    )
    expect(postResponse.status).toBe(200)
    const postData = assertBlueskyStatusContract(await postResponse.json())

    const boostResponse = await getStatus(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(localBoostId)}`
      ),
      { params: Promise.resolve({ id: urlToId(localBoostId) }) }
    )
    expect(boostResponse.status).toBe(200)
    assertBlueskyStatusContract(await boostResponse.json(), {
      expectBoostWrapper: true
    })

    const contextResponse = await getStatusContext(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(bskyPostId)}/context`
      ),
      { params: Promise.resolve({ id: urlToId(bskyPostId) }) }
    )
    expect(contextResponse.status).toBe(200)
    const contextData = (await contextResponse.json()) as {
      ancestors: unknown[]
      descendants: unknown[]
    }
    assertCleanJson(contextData)
    expect(contextData.descendants).toHaveLength(1)
    const descendant = assertBlueskyStatusContract(contextData.descendants[0])
    expect(descendant.uri).toBe(bskyReplyId)
    expect(descendant.in_reply_to_id).toBe(postData.id)

    const sourceResponse = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(bskyPostId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(bskyPostId) }) }
    )
    expect(sourceResponse.status).toBe(200)
    const sourceData = (await sourceResponse.json()) as {
      id: string
      text: string
      spoiler_text: string
    }
    assertCleanJson(sourceData)
    expect(sourceData.id).toBe(postData.id)
    expect(sourceData.text).toBe(
      'Check out this link:\nhttps://example.com/article'
    )
    expect(sourceData.text).not.toContain('<p>')
  })

  it('satisfies strict client contract on GET /api/v1/accounts/:id and /accounts/:id/statuses', async () => {
    const accountResponse = await getAccount(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(authorActorId)}`
      ),
      { params: Promise.resolve({ id: urlToId(authorActorId) }) }
    )
    expect(accountResponse.status).toBe(200)
    const accountData = assertBlueskyAccountContract(
      await accountResponse.json()
    )
    expect(accountData.acct).toBe(`${AUTHOR_HANDLE}@bsky.app`)

    const statusesResponse = await getAccountStatuses(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(authorActorId)}/statuses`
      ),
      { params: Promise.resolve({ id: urlToId(authorActorId) }) }
    )
    expect(statusesResponse.status).toBe(200)
    const statusesData = (await statusesResponse.json()) as unknown[]
    assertCleanJson(statusesData)
    expect(statusesData).toHaveLength(1)
    const first = assertBlueskyStatusContract(statusesData[0])
    expect(first.uri).toBe(bskyPostId)
  })

  it('pages mixed ActivityPub and Bluesky items cleanly on GET /api/v1/timelines/home with max_id, since_id, and min_id', async () => {
    const firstPageResponse = await getTimeline(
      new NextRequest('https://llun.test/api/v1/timelines/home?limit=2'),
      { params: Promise.resolve({ timeline: 'home' }) }
    )
    expect(firstPageResponse.status).toBe(200)
    const firstPage = (await firstPageResponse.json()) as Mastodon.Status[]
    assertCleanJson(firstPage)
    expect(firstPage).toHaveLength(2)
    expect(firstPage.map((s) => s.uri)).toEqual([
      localNewerPostId,
      localBoostId
    ])
    Mastodon.Status.parse(firstPage[0])
    assertBlueskyStatusContract(firstPage[1], { expectBoostWrapper: true })

    // max_id from the local boost of the Bluesky post reaches the Bluesky post + older local post.
    const olderPageResponse = await getTimeline(
      new NextRequest(
        `https://llun.test/api/v1/timelines/home?limit=2&max_id=${encodeURIComponent(firstPage[1].id)}`
      ),
      { params: Promise.resolve({ timeline: 'home' }) }
    )
    expect(olderPageResponse.status).toBe(200)
    const olderPage = (await olderPageResponse.json()) as Mastodon.Status[]
    assertCleanJson(olderPage)
    expect(olderPage).toHaveLength(2)
    expect(olderPage.map((s) => s.uri)).toEqual([bskyPostId, localOlderPostId])
    assertBlueskyStatusContract(olderPage[0])
    Mastodon.Status.parse(olderPage[1])

    // since_id from the Bluesky post returns newer items (local newer + local boost).
    const sincePageResponse = await getTimeline(
      new NextRequest(
        `https://llun.test/api/v1/timelines/home?limit=10&since_id=${encodeURIComponent(olderPage[0].id)}`
      ),
      { params: Promise.resolve({ timeline: 'home' }) }
    )
    expect(sincePageResponse.status).toBe(200)
    const sincePage = (await sincePageResponse.json()) as Mastodon.Status[]
    assertCleanJson(sincePage)
    expect(sincePage.map((s) => s.uri)).toEqual([
      localNewerPostId,
      localBoostId
    ])

    // min_id from the Bluesky post also returns the immediately newer items without duplicates.
    const minPageResponse = await getTimeline(
      new NextRequest(
        `https://llun.test/api/v1/timelines/home?limit=1&min_id=${encodeURIComponent(olderPage[0].id)}`
      ),
      { params: Promise.resolve({ timeline: 'home' }) }
    )
    expect(minPageResponse.status).toBe(200)
    const minPage = (await minPageResponse.json()) as Mastodon.Status[]
    assertCleanJson(minPage)
    expect(minPage).toHaveLength(1)
    expect(minPage[0].uri).toBe(localBoostId)
    assertBlueskyStatusContract(minPage[0], { expectBoostWrapper: true })
  })

  it('satisfies strict client contract on GET /api/v2/notifications for Bluesky like, repost, reply, and follow', async () => {
    const response = await getNotificationsV2(
      new NextRequest('https://llun.test/api/v2/notifications?limit=20'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const envelope = (await response.json()) as {
      notification_groups: Array<{
        group_key: string
        type: string
        most_recent_notification_id: number
        notifications_count: number
        latest_page_notification_at: string
        sample_account_ids: string[]
        status_id?: string | null
      }>
      accounts: unknown[]
      statuses: unknown[]
    }
    assertCleanJson(envelope)

    const types = new Set(envelope.notification_groups.map((g) => g.type))
    expect(types.has('favourite')).toBe(true)
    expect(types.has('reblog')).toBe(true)
    expect(types.has('mention')).toBe(true)
    expect(types.has('follow')).toBe(true)

    const accountIds = new Set<string>()
    for (const rawAccount of envelope.accounts) {
      const parsed = Mastodon.Account.parse(rawAccount)
      expect(parsed.id.length).toBeGreaterThan(0)
      assertAbsoluteHttpsUrl(parsed.url)
      expect(parsed.created_at).toMatch(ISO_8601_UTC)
      if (parsed.url.startsWith('https://bsky.app/')) {
        expect(parsed.acct.endsWith('@bsky.app')).toBe(true)
      }
      accountIds.add(parsed.id)
    }

    const statusIds = new Set<string>()
    for (const rawStatus of envelope.statuses) {
      const parsed = Mastodon.Status.parse(rawStatus)
      if (parsed.uri.startsWith('https://bsky.app/')) {
        assertBlueskyStatusContract(rawStatus)
      }
      statusIds.add(parsed.id)
    }

    for (const group of envelope.notification_groups) {
      expect(group.group_key.length).toBeGreaterThan(0)
      expect(typeof group.most_recent_notification_id).toBe('number')
      expect(group.latest_page_notification_at).toMatch(ISO_8601_UTC)
      expect(group.sample_account_ids.length).toBeGreaterThan(0)
      for (const accountId of group.sample_account_ids) {
        expect(accountIds.has(accountId)).toBe(true)
      }
      if (group.status_id) {
        expect(statusIds.has(group.status_id)).toBe(true)
      }
    }
  })

  it('satisfies strict client contract on GET /api/v2/search with a Bluesky handle', async () => {
    const storedResponse = await searchV2(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(`${AUTHOR_HANDLE}@bsky.app`)}&type=accounts`
      ),
      { params: Promise.resolve({}) }
    )
    expect(storedResponse.status).toBe(200)
    const storedPayload = (await storedResponse.json()) as {
      accounts: unknown[]
      statuses: unknown[]
      hashtags: unknown[]
    }
    assertCleanJson(storedPayload)
    expect(storedPayload.accounts).toHaveLength(1)
    const found = assertBlueskyAccountContract(storedPayload.accounts[0])
    expect(found.acct).toBe(`${AUTHOR_HANDLE}@bsky.app`)

    // Also test resolve=true for a fresh Bluesky handle via mocked AppView.
    const freshDid = `did:plc:${'r'.repeat(24)}`
    vi.mocked(getPublicProfile).mockResolvedValueOnce({
      did: freshDid,
      handle: 'resolvedsky.bsky.social',
      displayName: 'Resolved Sky',
      description: 'Freshly resolved profile',
      avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:rrr/avatar@jpeg',
      followersCount: 7,
      followsCount: 3,
      postsCount: 1
    })

    const resolvedResponse = await searchV2(
      new NextRequest(
        'https://llun.test/api/v2/search?q=resolvedsky.bsky.social&type=accounts&resolve=true'
      ),
      { params: Promise.resolve({}) }
    )
    expect(resolvedResponse.status).toBe(200)
    const resolvedPayload = (await resolvedResponse.json()) as {
      accounts: unknown[]
    }
    assertCleanJson(resolvedPayload)
    expect(resolvedPayload.accounts.length).toBeGreaterThanOrEqual(1)
    const resolvedAccount = assertBlueskyAccountContract(
      resolvedPayload.accounts[0]
    )
    expect(resolvedAccount.acct).toBe('resolvedsky.bsky.social@bsky.app')
    expect(resolvedAccount.url).toBe(blueskyActorId(freshDid))

    // Verify the resolved account id matches blueskyPostId prefix convention.
    expect(blueskyPostId(freshDid, 'k1')).toMatch(
      /^https:\/\/bsky\.app\/profile\/did:plc:/
    )
  })
})

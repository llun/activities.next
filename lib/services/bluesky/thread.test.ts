import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getPublicPostThread } from '@/lib/services/bluesky/appview'
import {
  blueskyPostId,
  parseBlueskyPostView,
  storeBlueskyPostView
} from '@/lib/services/bluesky/records'
import {
  BLUESKY_THREAD_VIEWER_RATE_LIMIT,
  loadBlueskyThread
} from '@/lib/services/bluesky/thread'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicPostThread: vi.fn()
}))

const did = (name: string) => `did:plc:${name.padEnd(24, 'a')}`

const author = (name: string) => ({
  did: did(name),
  handle: `${name}.bsky.social`,
  displayName: name.toUpperCase(),
  avatar: `https://cdn.bsky.app/${name}.jpg`
})

const postView = (
  name: string,
  rkey: string,
  {
    text = `post ${rkey}`,
    createdAt = '2026-01-01T00:00:00.000Z',
    parentUri,
    rootUri
  }: {
    text?: string
    createdAt?: string
    parentUri?: string
    rootUri?: string
  } = {}
) => ({
  uri: `at://${did(name)}/app.bsky.feed.post/${rkey}`,
  cid: `cid-${rkey}`,
  author: author(name),
  record: {
    $type: 'app.bsky.feed.post',
    text,
    createdAt,
    ...(parentUri
      ? {
          reply: {
            root: { uri: rootUri ?? parentUri },
            parent: { uri: parentUri }
          }
        }
      : null)
  },
  indexedAt: createdAt
})

describe('loadBlueskyThread', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let linkedViewer: Actor
  let unlinkedViewer: Actor

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.createAccount({
      email: `linked@${TEST_DOMAIN}`,
      username: 'linked',
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: 'priv-linked',
      publicKey: 'pub-linked'
    })
    await database.createAccount({
      email: `unlinked@${TEST_DOMAIN}`,
      username: 'unlinked',
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: 'priv-unlinked',
      publicKey: 'pub-unlinked'
    })
    linkedViewer = (await database.getActorFromId({
      id: `https://${TEST_DOMAIN}/users/linked`
    })) as Actor
    unlinkedViewer = (await database.getActorFromId({
      id: `https://${TEST_DOMAIN}/users/unlinked`
    })) as Actor
    await database.saveBlueskyAccount({
      actorId: linkedViewer.id,
      did: did('viewer'),
      handle: 'viewer.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.mocked(getPublicPostThread).mockReset()
    await database.deleteRateLimits({
      keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
      before: Date.now() + 24 * 60 * 60 * 1000
    })
  })

  const storeView = async (view: ReturnType<typeof postView>) => {
    const parsed = parseBlueskyPostView(view)
    if (!parsed) throw new Error('invalid fixture')
    return (await storeBlueskyPostView(database, parsed)) as string
  }

  it('stores parents and replies from getPostThread so getStatusContext returns the conversation', async () => {
    const rootView = postView('alice', 'r0', {
      text: 'root',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const parentView = postView('bob', 'p1', {
      text: 'parent',
      createdAt: '2026-01-01T00:01:00.000Z',
      parentUri: rootView.uri,
      rootUri: rootView.uri
    })
    const focusedView = postView('carol', 'f2', {
      text: 'focused',
      createdAt: '2026-01-01T00:02:00.000Z',
      parentUri: parentView.uri,
      rootUri: rootView.uri
    })
    const reply1View = postView('dave', 'd3', {
      text: 'reply 1',
      createdAt: '2026-01-01T00:03:00.000Z',
      parentUri: focusedView.uri,
      rootUri: rootView.uri
    })
    const nestedReplyView = postView('erin', 'e4', {
      text: 'nested reply',
      createdAt: '2026-01-01T00:04:00.000Z',
      parentUri: reply1View.uri,
      rootUri: rootView.uri
    })

    const focusedId = await storeView(focusedView)

    vi.mocked(getPublicPostThread).mockResolvedValueOnce({
      thread: {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: focusedView,
        parent: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: parentView,
          parent: {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: rootView
          }
        },
        replies: [
          {
            $type: 'app.bsky.feed.defs#blockedPost',
            uri: `at://${did('blocked')}/app.bsky.feed.post/x1`,
            blocked: true
          },
          {
            $type: 'app.bsky.feed.defs#notFoundPost',
            uri: `at://${did('gone')}/app.bsky.feed.post/x2`,
            notFound: true
          },
          {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: reply1View,
            replies: [
              {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: nestedReplyView,
                replies: []
              }
            ]
          }
        ]
      }
    })

    await loadBlueskyThread(database, linkedViewer, focusedId)

    expect(getPublicPostThread).toHaveBeenCalledWith(focusedView.uri, {
      depth: 6,
      parentHeight: 20
    })

    const context = await getStatusContext({
      database,
      statusId: focusedId,
      currentActor: linkedViewer
    })
    expect(context.ancestors.map((s) => s.id)).toEqual([
      blueskyPostId(did('alice'), 'r0'),
      blueskyPostId(did('bob'), 'p1')
    ])
    expect(context.descendants.map((s) => s.id)).toEqual([
      blueskyPostId(did('dave'), 'd3'),
      blueskyPostId(did('erin'), 'e4')
    ])

    // Rate-limited: a second call for the same post does not fetch again.
    await loadBlueskyThread(database, linkedViewer, focusedId)
    expect(getPublicPostThread).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a non-Bluesky status, an unstored post, or a viewer without a linked account', async () => {
    const view = postView('alice', 'unlinked1')
    const statusId = await storeView(view)

    await loadBlueskyThread(
      database,
      linkedViewer,
      `https://${TEST_DOMAIN}/users/linked/statuses/local-1`
    )
    await loadBlueskyThread(
      database,
      linkedViewer,
      blueskyPostId(did('alice'), 'not-stored')
    )
    await loadBlueskyThread(database, unlinkedViewer, statusId)

    expect(getPublicPostThread).not.toHaveBeenCalled()
  })

  it('does nothing when federation policy disallows Bluesky', async () => {
    const view = postView('alice', 'policy1')
    const statusId = await storeView(view)
    const block = await database.createDomainBlock({
      domain: 'bsky.app',
      severity: 'suspend'
    })
    try {
      await loadBlueskyThread(database, linkedViewer, statusId)
    } finally {
      await database.deleteDomainBlock(block.id)
    }
    expect(getPublicPostThread).not.toHaveBeenCalled()
  })

  it('ignores a mismatched root post and never throws on AppView errors', async () => {
    const view = postView('alice', 'err1')
    const statusId = await storeView(view)
    vi.mocked(getPublicPostThread).mockRejectedValueOnce(
      new Error('AppView down')
    )

    await expect(
      loadBlueskyThread(database, linkedViewer, statusId)
    ).resolves.toBeUndefined()

    const view2 = postView('alice', 'mismatch1')
    const statusId2 = await storeView(view2)
    const otherReply = postView('bob', 'mr1', { parentUri: view2.uri })
    vi.mocked(getPublicPostThread).mockResolvedValueOnce({
      thread: {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: postView('alice', 'wrong'),
        replies: [
          {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: otherReply
          }
        ]
      }
    })
    await loadBlueskyThread(database, linkedViewer, statusId2)
    expect(
      await database.getStatus({ statusId: blueskyPostId(did('bob'), 'mr1') })
    ).toBeNull()
  })

  it('enforces a per-viewer rate limit and silently skips AppView reads once over budget', async () => {
    vi.mocked(getPublicPostThread).mockResolvedValue({ thread: null })

    for (let i = 0; i < BLUESKY_THREAD_VIEWER_RATE_LIMIT.limit; i += 1) {
      const view = postView('alice', `budget${i}`)
      const id = await storeView(view)
      await loadBlueskyThread(database, linkedViewer, id)
    }
    expect(getPublicPostThread).toHaveBeenCalledTimes(
      BLUESKY_THREAD_VIEWER_RATE_LIMIT.limit
    )

    // The 31st distinct post is silently skipped without calling AppView or throwing.
    const extraView = postView('alice', 'budgetover')
    const extraId = await storeView(extraView)
    await expect(
      loadBlueskyThread(database, linkedViewer, extraId)
    ).resolves.toBeUndefined()
    expect(getPublicPostThread).toHaveBeenCalledTimes(
      BLUESKY_THREAD_VIEWER_RATE_LIMIT.limit
    )
  })

  it('does not spend the per-viewer budget when re-opening an already-claimed post', async () => {
    vi.mocked(getPublicPostThread).mockResolvedValue({ thread: null })

    const firstView = postView('alice', 'reopenfirst')
    const firstId = await storeView(firstView)
    const secondView = postView('alice', 'reopensecond')
    const secondId = await storeView(secondView)

    await loadBlueskyThread(database, linkedViewer, firstId)
    expect(getPublicPostThread).toHaveBeenCalledTimes(1)

    // Re-opening the same post more times than the viewer limit must not
    // consume viewer budget because claimAppViewRead short-circuits first.
    for (let i = 0; i < BLUESKY_THREAD_VIEWER_RATE_LIMIT.limit; i += 1) {
      await loadBlueskyThread(database, linkedViewer, firstId)
    }
    expect(getPublicPostThread).toHaveBeenCalledTimes(1)

    // Opening a fresh distinct post still has viewer budget remaining.
    await loadBlueskyThread(database, linkedViewer, secondId)
    expect(getPublicPostThread).toHaveBeenCalledTimes(2)
    expect(getPublicPostThread).toHaveBeenLastCalledWith(secondView.uri, {
      depth: 6,
      parentHeight: 20
    })
  })
})

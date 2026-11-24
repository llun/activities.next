import crypto from 'node:crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { getPublicPosts } from '@/lib/services/bluesky/appview'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import { syncBlueskyHome } from '@/lib/services/bluesky/sync'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bluesky/agent')>()),
  getBlueskyAgent: vi.fn()
}))
vi.mock('@/lib/services/bluesky/appview', () => ({ getPublicPosts: vi.fn() }))

// A DID the strict did:plc pattern accepts.
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
    reply,
    ...rest
  }: {
    text?: string
    createdAt?: string
    embed?: unknown
    reply?: unknown
  } = {}
) => ({
  uri: `at://${did(name)}/app.bsky.feed.post/${rkey}`,
  cid: `cid-${rkey}`,
  author: author(name),
  record: { $type: 'app.bsky.feed.post', text, createdAt, reply },
  indexedAt: createdAt,
  ...rest
})

// What the public AppView answers for each post uri.
const appView = new Map<string, unknown>()
const publish = (...views: { uri: string }[]) => {
  for (const view of views) appView.set(view.uri, view)
}

describe('syncBlueskyHome', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let actor: Actor
  const get = vi.fn()

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
      did: 'did:plc:reader',
      handle: 'reader.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    get.mockReset()
    vi.mocked(getPublicPosts).mockImplementation(async (uris) =>
      uris.flatMap((uri) => (appView.has(uri) ? [appView.get(uri)] : []))
    )
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: 'did:plc:reader',
      pdsUrl: 'https://pds.example.net/',
      get,
      post: vi.fn()
    })
  })

  const homeStatusIds = async () =>
    (
      await testDb.db
        .selectFrom('timelines')
        .select('statusId')
        .where('actorId', '=', actor.id)
        .where('timeline', '=', 'main')
        .execute()
    ).map((row) => row.statusId)

  const account = () => database.getBlueskyAccount({ actorId: actor.id })

  it('stores the authors and posts, oldest first, and adds them to Home', async () => {
    const newer = postView('alice', 'a2', {
      text: 'newer',
      createdAt: '2026-01-02T00:00:00.000Z',
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [
          {
            fullsize: 'https://cdn.bsky.app/full.jpg',
            thumb: 'https://cdn.bsky.app/thumb.jpg',
            alt: 'A cat'
          }
        ]
      }
    })
    const older = postView('bob', 'b1', { text: 'older' })
    // A post dated ahead of this server's clock.
    const future = postView('bob', 'b2', {
      createdAt: '2999-01-01T00:00:00.000Z'
    })
    publish(newer, older, future)
    get.mockResolvedValue({
      feed: [{ post: future }, { post: newer }, { post: older }]
    })

    const before = Date.now()
    await syncBlueskyHome(database, actor)

    expect(get).toHaveBeenCalledWith('app.bsky.feed.getTimeline', {
      limit: 50,
      cursor: undefined
    })
    const aliceId = blueskyActorId(did('alice'))
    expect(
      await database.getMastodonActorFromId({ id: aliceId })
    ).toMatchObject({
      acct: 'alice.bsky.social@bsky.app',
      display_name: 'ALICE',
      avatar: 'https://cdn.bsky.app/alice.jpg'
    })
    const newerId = blueskyPostId(did('alice'), 'a2')
    expect(
      await database.getBlueskyRecordByUri({ uri: newer.uri })
    ).toMatchObject({ statusId: newerId, cid: 'cid-a2' })
    const status = await database.getStatus({ statusId: newerId })
    expect(status).toMatchObject({
      actorId: aliceId,
      text: '<p>newer</p>',
      createdAt: Date.parse('2026-01-02T00:00:00.000Z')
    })
    expect(status?.type === 'Note' && status.attachments).toMatchObject([
      { url: 'https://cdn.bsky.app/full.jpg', name: 'A cat' }
    ])
    const futureStatus = await database.getStatus({
      statusId: blueskyPostId(did('bob'), 'b2')
    })
    expect(futureStatus?.createdAt).toBeLessThanOrEqual(Date.now())

    expect((await homeStatusIds()).sort()).toEqual(
      [
        blueskyPostId(did('bob'), 'b1'),
        newerId,
        blueskyPostId(did('bob'), 'b2')
      ].sort()
    )
    const synced = await account()
    expect(synced?.lastSyncedAt).toBeGreaterThanOrEqual(before)
    expect(synced?.syncError).toBeNull()
  })

  it('stores what the AppView says, not what the PDS says', async () => {
    const real = postView('mallory', 'm1', { text: 'the real post' })
    publish(real)
    const forged = {
      ...real,
      author: { ...author('mallory'), displayName: 'Forged name' },
      record: { ...real.record, text: 'forged text' },
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [{ fullsize: 'https://evil.example/x.jpg' }]
      }
    }
    // Named by the PDS but not returned by the AppView (deleted, blocked).
    const missing = postView('mallory', 'm2', { text: 'never published' })
    get.mockResolvedValue({ feed: [{ post: missing }, { post: forged }] })

    await syncBlueskyHome(database, actor)

    const statusId = blueskyPostId(did('mallory'), 'm1')
    const status = await database.getStatus({ statusId })
    expect(status).toMatchObject({ text: '<p>the real post</p>' })
    expect(status?.type === 'Note' && status.attachments).toEqual([])
    expect(
      await database.getMastodonActorFromId({
        id: blueskyActorId(did('mallory'))
      })
    ).toMatchObject({ display_name: 'MALLORY' })
    expect(
      await database.getBlueskyRecordByUri({ uri: missing.uri })
    ).toBeNull()
    expect(await homeStatusIds()).toContain(statusId)
    expect(await homeStatusIds()).not.toContain(
      blueskyPostId(did('mallory'), 'm2')
    )
  })

  it("stops at a post already in this actor's Home", async () => {
    publish(postView('alice', 'a3'), postView('alice', 'a0'))
    get.mockResolvedValueOnce({
      feed: [
        { post: postView('alice', 'a3') },
        { post: postView('alice', 'a2') },
        { post: postView('alice', 'a0') }
      ],
      cursor: 'next'
    })

    await syncBlueskyHome(database, actor)

    expect(get).toHaveBeenCalledTimes(1)
    expect(await homeStatusIds()).toContain(blueskyPostId(did('alice'), 'a3'))
    expect(
      await database.getBlueskyRecordByUri({
        uri: postView('alice', 'a0').uri
      })
    ).toBeNull()
  })

  it("does not stop at a post another actor's sync stored", async () => {
    await database.createAccount({
      email: `second@${TEST_DOMAIN}`,
      username: 'second',
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: 'privateKey-second',
      publicKey: 'publicKey-second'
    })
    const second = (await database.getActorFromId({
      id: `https://${TEST_DOMAIN}/users/second`
    })) as Actor
    await database.saveBlueskyAccount({
      actorId: second.id,
      did: 'did:plc:second',
      handle: 'second.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
    // a2 and a3 are stored rows and in the first reader's Home already.
    get.mockResolvedValueOnce({
      feed: [
        { post: postView('alice', 'a3') },
        { post: postView('alice', 'a2') },
        { post: postView('alice', 'a0') }
      ]
    })

    await syncBlueskyHome(database, second)

    const home = (
      await testDb.db
        .selectFrom('timelines')
        .select('statusId')
        .where('actorId', '=', second.id)
        .where('timeline', '=', 'main')
        .execute()
    ).map((row) => row.statusId)
    expect(home.sort()).toEqual(
      ['a0', 'a2', 'a3'].map((rkey) => blueskyPostId(did('alice'), rkey)).sort()
    )
  })

  it('skips a post that cannot be stored and stores the rest', async () => {
    const broken = postView('ivan', 'i1')
    const fine = postView('ivan', 'i2')
    publish(broken, fine)
    get.mockResolvedValue({ feed: [{ post: fine }, { post: broken }] })
    const upsert = database.upsertBlueskyPost
    const spy = vi
      .spyOn(database, 'upsertBlueskyPost')
      .mockImplementation(async (params) => {
        if (params.uri === broken.uri) throw new Error('value too long')
        return upsert(params)
      })
    try {
      await syncBlueskyHome(database, actor)
    } finally {
      spy.mockRestore()
    }

    const home = await homeStatusIds()
    expect(home).toContain(blueskyPostId(did('ivan'), 'i2'))
    expect(home).not.toContain(blueskyPostId(did('ivan'), 'i1'))
    expect((await account())?.syncError).toBeNull()

    // Never in Home, so the next sync does not stop before it.
    get.mockResolvedValue({ feed: [{ post: broken }] })
    await syncBlueskyHome(database, actor)
    expect(await homeStatusIds()).toContain(blueskyPostId(did('ivan'), 'i1'))
  })

  it('reads at most 50 items a page and 150 in all, whatever the PDS returns', async () => {
    let page = 0
    get.mockImplementation(async () => {
      page++
      return {
        feed: Array.from({ length: 60 }, (_, index) => ({
          post: postView('judy', `p${page}x${index}`)
        })),
        cursor: `p${page}`
      }
    })
    vi.mocked(getPublicPosts).mockClear()

    await syncBlueskyHome(database, actor)

    expect(get).toHaveBeenCalledTimes(3)
    const uris = vi.mocked(getPublicPosts).mock.calls[0][0]
    expect(uris).toHaveLength(150)
    expect(uris).not.toContain(postView('judy', 'p1x50').uri)
  })

  it('skips the run while another sync of the same actor holds its lock', async () => {
    const lockKey = `bluesky-sync:${crypto.createHash('sha256').update(actor.id).digest('hex')}`
    const lock = await database.acquireImportLock({ lockKey, ttlMs: 60_000 })
    expect(lock).not.toBeNull()
    get.mockResolvedValue({ feed: [] })
    try {
      await syncBlueskyHome(database, actor)
      expect(get).not.toHaveBeenCalled()
    } finally {
      await database.releaseImportLock({
        lockKey,
        token: lock?.token as string
      })
    }

    await syncBlueskyHome(database, actor)
    expect(get).toHaveBeenCalledTimes(1)
    // Released after the run.
    const again = await database.acquireImportLock({ lockKey, ttlMs: 60_000 })
    expect(again).not.toBeNull()
    await database.releaseImportLock({
      lockKey,
      token: again?.token as string
    })
  })

  it('reads at most three pages', async () => {
    let page = 0
    get.mockImplementation(async () => {
      page++
      return {
        feed: [{ post: postView('carol', `c${page}`) }],
        cursor: `p${page}`
      }
    })

    await syncBlueskyHome(database, actor)

    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenLastCalledWith('app.bsky.feed.getTimeline', {
      limit: 50,
      cursor: 'p2'
    })
  })

  it('stores the parent of a reply first and links the reply to it', async () => {
    const parent = postView('dave', 'd1')
    const reply = postView('erin', 'e1', {
      reply: { root: { uri: parent.uri }, parent: { uri: parent.uri } }
    })
    publish(parent, reply)
    // The PDS's reply context is not used: the parent comes from the
    // AppView's record of the reply.
    get.mockResolvedValue({
      feed: [{ post: reply, reply: { parent: postView('zed', 'z1') } }]
    })

    await syncBlueskyHome(database, actor)

    const parentId = blueskyPostId(did('dave'), 'd1')
    expect(
      await database.getStatus({
        statusId: blueskyPostId(did('erin'), 'e1')
      })
    ).toMatchObject({ reply: parentId })
    expect(await database.getStatus({ statusId: parentId })).not.toBeNull()
    // Only the feed item itself goes to Home.
    expect(await homeStatusIds()).not.toContain(parentId)
    expect(
      await database.getBlueskyRecordByUri({ uri: postView('zed', 'z1').uri })
    ).toBeNull()
  })

  it('shows the original post of a repost, dated at the repost, and does not stop at one already stored', async () => {
    const reposted = postView('frank', 'f1')
    const notAPost = {
      ...postView('frank', 'f9'),
      record: { $type: 'app.bsky.feed.like' }
    }
    publish(reposted, postView('frank', 'f0'), notAPost)
    const repostedAt = '2026-03-01T00:00:00.000Z'
    get.mockResolvedValue({
      feed: [
        {
          post: reposted,
          reason: {
            $type: 'app.bsky.feed.defs#reasonRepost',
            by: author('gina'),
            indexedAt: repostedAt
          }
        },
        // Stored by the first test: a repost of it must not end the walk.
        {
          post: postView('alice', 'a2'),
          reason: {
            $type: 'app.bsky.feed.defs#reasonRepost',
            by: author('gina')
          }
        },
        { post: postView('frank', 'f0') },
        // Not a post: skipped.
        { post: notAPost }
      ]
    })

    await syncBlueskyHome(database, actor)

    const home = await homeStatusIds()
    expect(home).toContain(blueskyPostId(did('frank'), 'f1'))
    expect(home).toContain(blueskyPostId(did('frank'), 'f0'))
    expect(home).not.toContain(blueskyPostId(did('frank'), 'f9'))
    expect(
      await database.getStatus({
        statusId: blueskyPostId(did('frank'), 'f1')
      })
    ).toMatchObject({ actorId: blueskyActorId(did('frank')) })
    const row = await testDb.db
      .selectFrom('timelines')
      .select('createdAt')
      .where('actorId', '=', actor.id)
      .where('statusId', '=', blueskyPostId(did('frank'), 'f1'))
      .executeTakeFirst()
    expect(Number(row?.createdAt)).toBe(Date.parse(repostedAt))
  })

  it('stores a reply whose parent cannot be stored', async () => {
    const parent = postView('kate', 'k1')
    const reply = postView('liam', 'l1', {
      reply: { root: { uri: parent.uri }, parent: { uri: parent.uri } }
    })
    publish(parent, reply)
    get.mockResolvedValue({ feed: [{ post: reply }] })
    const upsert = database.upsertBlueskyPost
    const spy = vi
      .spyOn(database, 'upsertBlueskyPost')
      .mockImplementation(async (params) => {
        if (params.uri === parent.uri) throw new Error('value too long')
        return upsert(params)
      })
    try {
      await syncBlueskyHome(database, actor)
    } finally {
      spy.mockRestore()
    }

    expect(await homeStatusIds()).toContain(blueskyPostId(did('liam'), 'l1'))
    expect(
      await database.getStatus({ statusId: blueskyPostId(did('kate'), 'k1') })
    ).toBeNull()
    expect((await account())?.syncError).toBeNull()
  })

  it('dates a repost from the future at now in Home', async () => {
    const reposted = postView('mona', 'm1')
    publish(reposted)
    get.mockResolvedValue({
      feed: [
        {
          post: reposted,
          reason: {
            $type: 'app.bsky.feed.defs#reasonRepost',
            by: author('gina'),
            indexedAt: '2999-01-01T00:00:00.000Z'
          }
        }
      ]
    })

    await syncBlueskyHome(database, actor)

    const row = await testDb.db
      .selectFrom('timelines')
      .select('createdAt')
      .where('actorId', '=', actor.id)
      .where('statusId', '=', blueskyPostId(did('mona'), 'm1'))
      .executeTakeFirst()
    expect(row).toBeDefined()
    expect(Number(row?.createdAt)).toBeLessThanOrEqual(Date.now())
  })

  it('records an ended session without throwing', async () => {
    const lastSyncedAt = (await account())?.lastSyncedAt
    get.mockRejectedValue(new BlueskySessionEndedError())

    await expect(syncBlueskyHome(database, actor)).resolves.toBeUndefined()

    expect(await account()).toMatchObject({
      lastSyncedAt,
      syncError: 'Bluesky ended this session.'
    })
  })

  it('records any other failure as a short message without throwing', async () => {
    get.mockRejectedValue(
      new BlueskyRequestError('app.bsky.feed.getTimeline', 502, 'Upstream')
    )
    await syncBlueskyHome(database, actor)
    expect((await account())?.syncError).toBe(
      'Bluesky refused the request (502). Trying again in a few minutes.'
    )

    get.mockRejectedValue(new Error('socket hang up'))
    await syncBlueskyHome(database, actor)
    expect((await account())?.syncError).toBe(
      'Home sync failed. Trying again in a few minutes.'
    )

    // The next good sync clears it.
    get.mockResolvedValue({ feed: [] })
    await syncBlueskyHome(database, actor)
    expect((await account())?.syncError).toBeNull()
  })

  it('records no error when the account was relinked during the run', async () => {
    await database.updateBlueskyAccountSync({
      actorId: actor.id,
      syncError: null
    })
    const update = vi.spyOn(database, 'updateBlueskyAccountSync')
    get.mockRejectedValue(new BlueskySessionChangedError())

    try {
      await expect(syncBlueskyHome(database, actor)).resolves.toBeUndefined()
    } finally {
      update.mockRestore()
    }

    expect(update).not.toHaveBeenCalled()
    expect((await account())?.syncError).toBeNull()
  })

  it('does nothing without a linked session', async () => {
    vi.mocked(getBlueskyAgent).mockResolvedValue(null)
    await syncBlueskyHome(database, actor)
    expect(get).not.toHaveBeenCalled()
  })

  it('records an error and skips the agent when federation policy disallows Bluesky', async () => {
    const block = await database.createDomainBlock({
      domain: 'bsky.app',
      severity: 'suspend'
    })
    vi.mocked(getBlueskyAgent).mockClear()
    try {
      await syncBlueskyHome(database, actor)
    } finally {
      await database.deleteDomainBlock(block.id)
    }

    expect(getBlueskyAgent).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect((await account())?.syncError).toBe(
      'This server does not allow Bluesky.'
    )
  })
})

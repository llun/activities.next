import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  type BlueskyAgent,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import {
  loadBlueskyAuthorFeed,
  parseBlueskyProfileInput,
  refreshBlueskyProfile,
  resolveBlueskyProfile
} from '@/lib/services/bluesky/profiles'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

const DID = `did:plc:${'a'.repeat(24)}`
const OTHER_DID = `did:plc:${'b'.repeat(24)}`
const viewer = { id: 'https://local.test/users/viewer' } as Actor

const profileView = (overrides: Record<string, unknown> = {}) => ({
  did: DID,
  handle: 'Alice.bsky.social',
  displayName: 'Alice',
  description: 'Hello\nthere <b>',
  avatar: 'https://cdn.bsky.app/avatar.jpg',
  banner: 'https://cdn.bsky.app/banner.jpg',
  followersCount: 12,
  followsCount: 3,
  postsCount: 40,
  ...overrides
})

const mockAgent = (get: BlueskyAgent['get']) =>
  vi.mocked(getBlueskyAgent).mockResolvedValue({
    did: OTHER_DID,
    pdsUrl: 'https://pds.example.net/',
    get,
    post: vi.fn()
  })

describe('parseBlueskyProfileInput', () => {
  it.each([
    ['alice.bsky.social', 'alice.bsky.social'],
    ['@Alice.bsky.social', 'alice.bsky.social'],
    ['alice.bsky.social@bsky.app', 'alice.bsky.social'],
    ['@alice.bsky.social@BSKY.APP', 'alice.bsky.social'],
    [DID, DID],
    [`https://bsky.app/profile/${DID}`, DID],
    ['https://bsky.app/profile/alice.bsky.social', 'alice.bsky.social']
  ])('reads %s', (input, expected) => {
    expect(parseBlueskyProfileInput(input)).toBe(expected)
  })

  it.each([
    'alice',
    'alice@mastodon.social',
    'https://example.com/profile/alice.bsky.social',
    'https://bsky.app/profile/alice.bsky.social/post/1',
    'did:example:123'
  ])('refuses %s', (input) => {
    expect(parseBlueskyProfileInput(input)).toBeNull()
  })
})

describe('Bluesky profiles', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getBlueskyAgent).mockReset()
  })

  describe('resolveBlueskyProfile', () => {
    it('fetches nothing for input that is not a Bluesky account', async () => {
      expect(
        await resolveBlueskyProfile(database, viewer, 'alice@mastodon.social')
      ).toBeNull()
      expect(getBlueskyAgent).not.toHaveBeenCalled()
    })

    it('is null without a linked account', async () => {
      vi.mocked(getBlueskyAgent).mockResolvedValue(null)
      expect(
        await resolveBlueskyProfile(database, viewer, 'nobody.bsky.social')
      ).toBeNull()
    })

    it('stores a fetched profile and returns its actor id', async () => {
      const get = vi.fn().mockResolvedValue(profileView())
      mockAgent(get)

      const actorId = await resolveBlueskyProfile(
        database,
        viewer,
        'https://bsky.app/profile/alice.bsky.social'
      )

      expect(actorId).toBe(blueskyActorId(DID))
      expect(get).toHaveBeenCalledWith('app.bsky.actor.getProfile', {
        actor: 'alice.bsky.social'
      })
      const actor = await database.getActorFromId({ id: actorId as string })
      expect(actor).toMatchObject({
        username: 'alice.bsky.social',
        domain: 'bsky.app',
        name: 'Alice',
        summary: '<p>Hello<br>there &lt;b&gt;</p>',
        followersCount: 12,
        followingCount: 3
      })
    })

    it('answers a stored account without a fetch while it is fresh', async () => {
      const get = vi.fn()
      mockAgent(get)
      expect(
        await resolveBlueskyProfile(
          database,
          viewer,
          'alice.bsky.social@bsky.app'
        )
      ).toBe(blueskyActorId(DID))
      expect(get).not.toHaveBeenCalled()
    })

    it('refuses a profile for another account than the one asked for', async () => {
      mockAgent(vi.fn().mockResolvedValue(profileView({ did: OTHER_DID })))
      expect(
        await resolveBlueskyProfile(
          database,
          viewer,
          `did:plc:${'c'.repeat(24)}`
        )
      ).toBeNull()
      mockAgent(
        vi
          .fn()
          .mockResolvedValue(
            profileView({ did: OTHER_DID, handle: 'bob.bsky.social' })
          )
      )
      expect(
        await resolveBlueskyProfile(database, viewer, 'carol.bsky.social')
      ).toBeNull()
      expect(
        await database.getActorFromId({ id: blueskyActorId(OTHER_DID) })
      ).toBeNull()
    })

    it('is null when Bluesky fails', async () => {
      mockAgent(vi.fn().mockRejectedValue(new Error('Profile not found')))
      expect(
        await resolveBlueskyProfile(database, viewer, 'gone.bsky.social')
      ).toBeNull()
    })
  })

  describe('refreshBlueskyProfile', () => {
    it('refreshes a stale actor and skips a fresh one', async () => {
      const actorId = blueskyActorId(DID)
      const get = vi
        .fn()
        .mockResolvedValue(profileView({ displayName: 'Alice Again' }))
      mockAgent(get)

      await refreshBlueskyProfile(database, viewer, actorId)
      expect(get).not.toHaveBeenCalled()

      await testDb.db
        .updateTable('actors')
        .set({ updatedAt: new Date(Date.now() - 11 * 60 * 1000) })
        .where('id', '=', actorId)
        .execute()
      await refreshBlueskyProfile(database, viewer, actorId)
      expect(get).toHaveBeenCalledWith('app.bsky.actor.getProfile', {
        actor: DID
      })
      expect(await database.getActorFromId({ id: actorId })).toMatchObject({
        name: 'Alice Again'
      })
    })

    it('ignores an id that is not a Bluesky actor', async () => {
      await refreshBlueskyProfile(
        database,
        viewer,
        'https://remote.test/users/alice'
      )
      expect(getBlueskyAgent).not.toHaveBeenCalled()
    })
  })

  describe('loadBlueskyAuthorFeed', () => {
    it("stores the author's own posts and skips reposts and others", async () => {
      const actorId = blueskyActorId(DID)
      const post = (rkey: string, extra: Record<string, unknown> = {}) => ({
        post: {
          uri: `at://${DID}/app.bsky.feed.post/${rkey}`,
          cid: `cid-${rkey}`,
          author: { did: DID, handle: 'alice.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: `Post ${rkey}`,
            createdAt: '2026-11-01T00:00:00.000Z'
          },
          indexedAt: '2026-11-01T00:00:01.000Z'
        },
        ...extra
      })
      const get = vi.fn().mockResolvedValue({
        feed: [
          post('one'),
          post('repost', {
            reason: { $type: 'app.bsky.feed.defs#reasonRepost' }
          }),
          {
            post: {
              ...post('other').post,
              uri: `at://${OTHER_DID}/app.bsky.feed.post/other`,
              author: { did: OTHER_DID, handle: 'bob.bsky.social' }
            }
          },
          {
            post: {
              ...post('reply').post,
              record: {
                text: 'A reply',
                createdAt: '2026-11-02T00:00:00.000Z',
                reply: {
                  parent: { uri: `at://${OTHER_DID}/app.bsky.feed.post/p1` }
                }
              }
            }
          }
        ]
      })
      mockAgent(get)

      await loadBlueskyAuthorFeed(database, viewer, actorId, { limit: 500 })

      expect(get).toHaveBeenCalledWith('app.bsky.feed.getAuthorFeed', {
        actor: DID,
        limit: 100
      })
      const statuses = await database.getActorStatuses({ actorId, limit: 10 })
      expect(statuses.map((status) => status.id).sort()).toEqual(
        [blueskyPostId(DID, 'one'), blueskyPostId(DID, 'reply')].sort()
      )
      const reply = statuses.find(
        (status) => status.id === blueskyPostId(DID, 'reply')
      )
      expect(reply).toMatchObject({ reply: blueskyPostId(OTHER_DID, 'p1') })
      expect(
        await database.getBlueskyRecordByUri({
          uri: `at://${DID}/app.bsky.feed.post/repost`
        })
      ).toBeNull()
    })

    it('does nothing without a linked account', async () => {
      vi.mocked(getBlueskyAgent).mockResolvedValue(null)
      await expect(
        loadBlueskyAuthorFeed(database, viewer, blueskyActorId(DID), {
          limit: 10
        })
      ).resolves.toBeUndefined()
    })
  })
})

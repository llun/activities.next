import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  getPublicAuthorFeed,
  getPublicProfile
} from '@/lib/services/bluesky/appview'
import {
  loadBlueskyAuthorFeed,
  parseBlueskyProfileInput,
  refreshBlueskyProfile,
  resolveBlueskyProfile
} from '@/lib/services/bluesky/profiles'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicProfile: vi.fn(),
  getPublicAuthorFeed: vi.fn()
}))

const DID = `did:plc:${'a'.repeat(24)}`
const OTHER_DID = `did:plc:${'b'.repeat(24)}`
const viewer = { id: 'https://local.test/users/viewer' } as Actor
// No linked Bluesky account: nothing is fetched for this viewer.
const unlinked = { id: 'https://local.test/users/unlinked' } as Actor

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
    await database.saveBlueskyAccount({
      actorId: viewer.id,
      did: OTHER_DID,
      handle: 'viewer.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getPublicProfile).mockReset()
    vi.mocked(getPublicAuthorFeed).mockReset()
  })

  describe('resolveBlueskyProfile', () => {
    it('fetches nothing for input that is not a Bluesky account', async () => {
      expect(
        await resolveBlueskyProfile(database, viewer, 'alice@mastodon.social')
      ).toBeNull()
      expect(getPublicProfile).not.toHaveBeenCalled()
    })

    it('is null without a linked account', async () => {
      vi.mocked(getPublicProfile).mockResolvedValue(profileView())
      expect(
        await resolveBlueskyProfile(database, unlinked, 'alice.bsky.social')
      ).toBeNull()
      expect(getPublicProfile).not.toHaveBeenCalled()
    })

    it('stores a fetched profile and returns its actor id', async () => {
      vi.mocked(getPublicProfile).mockResolvedValue(profileView())

      const actorId = await resolveBlueskyProfile(
        database,
        viewer,
        'https://bsky.app/profile/alice.bsky.social'
      )

      expect(actorId).toBe(blueskyActorId(DID))
      expect(getPublicProfile).toHaveBeenCalledWith('alice.bsky.social')
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
      expect(
        await resolveBlueskyProfile(
          database,
          viewer,
          'alice.bsky.social@bsky.app'
        )
      ).toBe(blueskyActorId(DID))
      expect(getPublicProfile).not.toHaveBeenCalled()
    })

    it('refuses a profile for another account than the one asked for', async () => {
      vi.mocked(getPublicProfile).mockResolvedValue(
        profileView({ did: OTHER_DID })
      )
      expect(
        await resolveBlueskyProfile(
          database,
          viewer,
          `did:plc:${'c'.repeat(24)}`
        )
      ).toBeNull()
      vi.mocked(getPublicProfile).mockResolvedValue(
        profileView({ did: OTHER_DID, handle: 'bob.bsky.social' })
      )
      expect(
        await resolveBlueskyProfile(database, viewer, 'carol.bsky.social')
      ).toBeNull()
      expect(
        await database.getActorFromId({ id: blueskyActorId(OTHER_DID) })
      ).toBeNull()
    })

    it('is null when Bluesky fails or has no such account', async () => {
      vi.mocked(getPublicProfile).mockRejectedValueOnce(new Error('down'))
      expect(
        await resolveBlueskyProfile(database, viewer, 'gone.bsky.social')
      ).toBeNull()
      vi.mocked(getPublicProfile).mockResolvedValueOnce(null)
      expect(
        await resolveBlueskyProfile(database, viewer, 'gone.bsky.social')
      ).toBeNull()
    })

    it('stores an account whose handle Bluesky could not verify under its DID', async () => {
      const did = `did:plc:${'d'.repeat(24)}`
      vi.mocked(getPublicProfile).mockResolvedValue(
        profileView({ did, handle: 'handle.invalid' })
      )
      expect(await resolveBlueskyProfile(database, viewer, did)).toBe(
        blueskyActorId(did)
      )
      expect(
        await database.getActorFromId({ id: blueskyActorId(did) })
      ).toMatchObject({ username: did, domain: 'bsky.app' })
      // The real holder of a handle keeps it.
      expect(
        await database.getActorFromUsername({
          username: 'alice.bsky.social',
          domain: 'bsky.app'
        })
      ).toMatchObject({ id: blueskyActorId(DID) })
    })
  })

  describe('refreshBlueskyProfile', () => {
    it('refreshes a stale actor and skips a fresh one', async () => {
      const actorId = blueskyActorId(DID)
      vi.mocked(getPublicProfile).mockResolvedValue(
        profileView({ displayName: 'Alice Again', banner: undefined })
      )

      await refreshBlueskyProfile(database, viewer, actorId)
      expect(getPublicProfile).not.toHaveBeenCalled()

      await testDb.db
        .updateTable('actors')
        .set({ updatedAt: new Date(Date.now() - 11 * 60 * 1000) })
        .where('id', '=', actorId)
        .execute()
      await refreshBlueskyProfile(database, unlinked, actorId)
      expect(getPublicProfile).not.toHaveBeenCalled()
      await refreshBlueskyProfile(database, viewer, actorId)
      expect(getPublicProfile).toHaveBeenCalledWith(DID)
      const refreshed = await database.getActorFromId({ id: actorId })
      expect(refreshed).toMatchObject({ name: 'Alice Again' })
      // A detailed profile without a banner clears the stored one.
      expect(refreshed?.headerImageUrl ?? '').toBe('')
    })

    it('ignores an id that is not a Bluesky actor', async () => {
      await refreshBlueskyProfile(
        database,
        viewer,
        'https://remote.test/users/alice'
      )
      expect(getPublicProfile).not.toHaveBeenCalled()
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
      vi.mocked(getPublicAuthorFeed).mockResolvedValue({
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
                $type: 'app.bsky.feed.post',
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

      await loadBlueskyAuthorFeed(database, viewer, actorId, { limit: 500 })

      expect(getPublicAuthorFeed).toHaveBeenCalledWith(DID, { limit: 100 })
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
      await expect(
        loadBlueskyAuthorFeed(database, unlinked, blueskyActorId(DID), {
          limit: 10
        })
      ).resolves.toBeUndefined()
      expect(getPublicAuthorFeed).not.toHaveBeenCalled()
    })
  })
})

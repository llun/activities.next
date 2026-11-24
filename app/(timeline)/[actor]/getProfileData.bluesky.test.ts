import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  loadBlueskyAuthorFeed,
  refreshBlueskyProfile,
  resolveBlueskyProfile
} from '@/lib/services/bluesky/profiles'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import type { Actor } from '@/lib/types/domain/actor'

import { getProfileData } from './getProfileData'

vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getWebfingerSelf')
vi.mock('@/lib/services/bluesky/profiles', () => ({
  loadBlueskyAuthorFeed: vi.fn(),
  refreshBlueskyProfile: vi.fn(),
  resolveBlueskyProfile: vi.fn()
}))

const DID = `did:plc:${'r'.repeat(24)}`
const ACTOR_ID = blueskyActorId(DID)
const viewer = {
  id: 'https://local.test/users/viewer',
  username: 'viewer',
  domain: 'local.test'
} as Actor

describe('getProfileData for a Bluesky account', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.upsertBlueskyActor({
      did: DID,
      handle: 'river.bsky.social',
      name: 'River',
      summary: '<p>Hi</p>',
      followersCount: 5,
      followingCount: 2,
      postsCount: 1
    })
    await database.upsertBlueskyPost({
      uri: `at://${DID}/app.bsky.feed.post/one`,
      cid: 'cid-one',
      did: DID,
      rkey: 'one',
      actorId: ACTOR_ID,
      text: '<p>First</p>',
      createdAt: Date.now() - 1000,
      attachments: []
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the stored account and posts and never fetches ActivityPub', async () => {
    const profile = await getProfileData(
      database,
      '@river.bsky.social@bsky.app',
      false,
      { currentActor: null }
    )

    expect(profile).toMatchObject({
      person: { id: ACTOR_ID, url: ACTOR_ID, name: 'River' },
      isInternalAccount: false,
      followersCount: 5
    })
    expect(profile?.statuses.map((status) => status.id)).toEqual([
      blueskyPostId(DID, 'one')
    ])
    expect(getActorPerson).not.toHaveBeenCalled()
    expect(getWebfingerSelf).not.toHaveBeenCalled()
    // A signed-out visitor contacts nothing.
    expect(refreshBlueskyProfile).not.toHaveBeenCalled()
    expect(loadBlueskyAuthorFeed).not.toHaveBeenCalled()
  })

  it('refreshes and loads posts for a signed-in viewer', async () => {
    await getProfileData(database, '@river.bsky.social@bsky.app', true, {
      currentActor: viewer
    })

    expect(refreshBlueskyProfile).toHaveBeenCalledWith(
      database,
      viewer,
      ACTOR_ID
    )
    expect(loadBlueskyAuthorFeed).toHaveBeenCalledWith(
      database,
      viewer,
      ACTOR_ID,
      { limit: expect.any(Number) }
    )
    expect(getActorPerson).not.toHaveBeenCalled()
  })

  it('shows the stored data when loading posts fails', async () => {
    vi.mocked(loadBlueskyAuthorFeed).mockRejectedValueOnce(new Error('down'))

    const profile = await getProfileData(
      database,
      '@river.bsky.social@bsky.app',
      true,
      { currentActor: viewer }
    )

    expect(profile?.statuses).toHaveLength(1)
  })

  it('resolves an unknown handle through the viewer linked account', async () => {
    vi.mocked(resolveBlueskyProfile).mockResolvedValueOnce(null)

    const profile = await getProfileData(
      database,
      '@unknown.bsky.social@bsky.app',
      true,
      { currentActor: viewer }
    )

    expect(profile).toBeNull()
    expect(resolveBlueskyProfile).toHaveBeenCalledWith(
      database,
      viewer,
      'unknown.bsky.social'
    )
    expect(getActorPerson).not.toHaveBeenCalled()
    expect(getWebfingerSelf).not.toHaveBeenCalled()
  })
})

import { Database } from '@/lib/database/types'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { runInReactCacheScope } from '@/lib/testing/reactCacheScope'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

import { getProfileData } from './getProfileData'

// Vitest resolves `react` to the client build, whose `cache` is a passthrough
// that never memoizes. Swap in the server build's `cache` — the one Next.js
// loads for Server Components and route handlers — so this file exercises the
// implementation production actually runs. See lib/testing/reactCacheScope.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const { serverCache } = await import('@/lib/testing/reactCacheScope')
  return { ...actual, cache: serverCache }
})

// Rendering `/@user@domain` for a signed-in visitor who is not the owner runs
// two independent lookups of the same follow row — one to scope which statuses
// the viewer may be shown, one for the follow button — from two call sites that
// cannot see each other. This is the request-level assertion that they collapse
// into a single query.
describe('profile follow lookup', () => {
  const PROFILE_ACTOR_ID = 'https://example.com/users/profile'
  const VIEWER_ACTOR_ID = 'https://example.com/users/viewer'
  const PROFILE_HANDLE = '@profile@example.com'

  const buildActor = (id: string, username: string): Actor => ({
    id,
    username,
    domain: 'example.com',
    name: username,
    summary: '',
    followersUrl: `${id}/followers`,
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl: 'https://example.com/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    publicKey: 'public-key',
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  })

  const profileActor: Actor & { account: { id: string } } = {
    ...buildActor(PROFILE_ACTOR_ID, 'profile'),
    // Only an actor with an account is local, which is the branch that scopes
    // its statuses by audience.
    account: { id: 'account-id' }
  } as Actor & { account: { id: string } }

  const viewer = buildActor(VIEWER_ACTOR_ID, 'viewer')

  const mockDatabase = {
    // getProfileData
    getActorFromUsername: vi.fn(),
    getActorStatuses: vi.fn(),
    getActorStatusesCount: vi.fn(),
    getAttachmentsForActor: vi.fn(),
    getActorFollowingCount: vi.fn(),
    getActorFollowersCount: vi.fn(),
    getActorHasFitnessData: vi.fn(),
    // getRelationship
    isCurrentActorFollowing: vi.fn(),
    isBlocking: vi.fn(),
    isDomainBlockedByActor: vi.fn(),
    getMute: vi.fn(),
    getAccountNote: vi.fn(),
    getEndorsement: vi.fn(),
    getActorPublicIds: vi.fn(),
    // The shared one
    getAcceptedOrRequestedFollow: vi.fn()
  }

  const database = mockDatabase as unknown as Database

  // Every call for the viewer's own follow of the profile actor. getRelationship
  // also reads the opposite direction (the profile actor's follow of the
  // viewer), which is a different row and deliberately not memoized.
  const viewerFollowCalls = () =>
    mockDatabase.getAcceptedOrRequestedFollow.mock.calls.filter(
      ([params]) =>
        params.actorId === VIEWER_ACTOR_ID &&
        params.targetActorId === PROFILE_ACTOR_ID
    )

  // What the page does, in the order it does it.
  const renderProfileForViewer = async () => {
    await getProfileData(database, PROFILE_HANDLE, true, {
      currentActor: viewer
    })
    await getRelationship({
      database,
      currentActor: viewer,
      targetActorId: PROFILE_ACTOR_ID
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorFromUsername.mockResolvedValue(profileActor)
    mockDatabase.getActorStatuses.mockResolvedValue([])
    mockDatabase.getActorStatusesCount.mockResolvedValue(0)
    mockDatabase.getAttachmentsForActor.mockResolvedValue([])
    mockDatabase.getActorFollowingCount.mockResolvedValue(0)
    mockDatabase.getActorFollowersCount.mockResolvedValue(0)
    mockDatabase.getActorHasFitnessData.mockResolvedValue(false)
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(true)
    mockDatabase.isBlocking.mockResolvedValue(false)
    mockDatabase.isDomainBlockedByActor.mockResolvedValue(false)
    mockDatabase.getMute.mockResolvedValue(null)
    mockDatabase.getAccountNote.mockResolvedValue('')
    mockDatabase.getEndorsement.mockResolvedValue(null)
    mockDatabase.getActorPublicIds.mockResolvedValue(new Map())
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      id: 'follow-id',
      actorId: VIEWER_ACTOR_ID,
      targetActorId: PROFILE_ACTOR_ID,
      status: FollowStatus.enum.Accepted
    })
  })

  it('reads the viewer follow once for a signed-in non-owner profile view', async () => {
    await runInReactCacheScope(renderProfileForViewer)

    expect(viewerFollowCalls()).toHaveLength(1)
  })

  it('still reports the viewer as a follower to both call sites', async () => {
    const { statuses, relationship } = await runInReactCacheScope(async () => {
      const profile = await getProfileData(database, PROFILE_HANDLE, true, {
        currentActor: viewer
      })
      return {
        statuses: mockDatabase.getActorStatuses.mock.calls[0][0],
        relationship: await getRelationship({
          database,
          currentActor: viewer,
          targetActorId: PROFILE_ACTOR_ID
        }),
        profile
      }
    })

    // The audience half: the memoized row still opens the followers-only scope.
    expect(statuses).toMatchObject({ includeFollowersOnly: true })
    // The relationship half: an Accepted follow is following, not requested.
    expect(relationship).toMatchObject({ following: true, requested: false })
  })

  it('does not carry the follow row between requests', async () => {
    await runInReactCacheScope(renderProfileForViewer)
    await runInReactCacheScope(renderProfileForViewer)

    expect(viewerFollowCalls()).toHaveLength(2)
  })
})

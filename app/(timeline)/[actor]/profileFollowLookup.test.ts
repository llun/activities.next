import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
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

vi.mock('@/lib/activities/getActorCollectionCounts')
vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')
vi.mock('@/lib/activities/getWebfingerSelf')
vi.mock('@/lib/services/federation/getFederationSigningActor')

// Rendering `/@user@domain` for a signed-in visitor who is not the owner runs
// two independent lookups of the same follow row — one to scope which statuses
// the viewer may be shown, one for the follow button — from two call sites that
// cannot see each other. This is the request-level assertion that they collapse
// into a single query.
describe('profile follow lookup', () => {
  const PROFILE_ACTOR_ID = 'https://example.com/users/profile'
  const VIEWER_ACTOR_ID = 'https://example.com/users/viewer'
  const PROFILE_HANDLE = '@profile@example.com'
  const REMOTE_ACTOR_ID = 'https://remote.test/users/remote'
  const REMOTE_HANDLE = '@remote@remote.test'

  // Only the fields getProfileData's remote branch reads off the fetched
  // document: the id it keys the audience lookup on, and the followers
  // collection it passes through as the audience.
  const remotePerson = {
    id: REMOTE_ACTOR_ID,
    followers: `${REMOTE_ACTOR_ID}/followers`
  } as Awaited<ReturnType<typeof getActorPerson>>

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
    // canFederateWithDomain (federation gate added on the remote persist path)
    getDomainBlockForDomain: vi.fn().mockResolvedValue(null),
    getDomainAllowForDomain: vi.fn().mockResolvedValue(null),
    // getProfileData persist branch resolves by the written id (person.id)
    getActorFromId: vi.fn().mockResolvedValue(null),
    // getRelationship
    isCurrentActorFollowing: vi.fn(),
    isBlocking: vi.fn(),
    isDomainBlockedByActor: vi.fn(),
    getMute: vi.fn(),
    getAccountNote: vi.fn(),
    getEndorsement: vi.fn(),
    getActorPublicIds: vi.fn().mockResolvedValue([]),
    createActor: vi.fn().mockResolvedValue(undefined),
    updateActor: vi.fn().mockResolvedValue(undefined),
    setActorCounters: vi.fn().mockResolvedValue(undefined),
    // The shared one
    getAcceptedOrRequestedFollow: vi.fn()
  }

  const database = mockDatabase as unknown as Database

  // Every call for the viewer's own follow of a target. getRelationship also
  // reads the opposite direction (the target's follow of the viewer), which is a
  // different row and deliberately not memoized.
  const viewerFollowCalls = (targetActorId: string) =>
    mockDatabase.getAcceptedOrRequestedFollow.mock.calls.filter(
      ([params]) =>
        params.actorId === VIEWER_ACTOR_ID &&
        params.targetActorId === targetActorId
    )

  // What the page does, in the order it does it — and, as the page does, taking
  // the relationship's target from the profile's own `person.id` rather than
  // from a constant. That is the identity the memoization depends on: if the two
  // halves ever named the actor differently, the keys would stop collapsing.
  const renderProfileForViewer = async (handle: string) => {
    const profile = await getProfileData(database, handle, true, {
      currentActor: viewer
    })
    if (!profile) throw new Error(`no profile for ${handle}`)
    await getRelationship({
      database,
      currentActor: viewer,
      targetActorId: profile.person.id
    })
    return profile
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

  describe('for a local actor', () => {
    it('reads the viewer follow once for a signed-in non-owner profile view', async () => {
      await runInReactCacheScope(() => renderProfileForViewer(PROFILE_HANDLE))

      expect(viewerFollowCalls(PROFILE_ACTOR_ID)).toHaveLength(1)
    })

    it('still reports the viewer as a follower to both call sites', async () => {
      const { statuses, relationship } = await runInReactCacheScope(
        async () => {
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
        }
      )

      // The audience half: the memoized row still opens the followers-only scope.
      expect(statuses).toMatchObject({ includeFollowersOnly: true })
      // The relationship half: an Accepted follow is following, not requested.
      expect(relationship).toMatchObject({ following: true, requested: false })
    })

    it('does not carry the follow row between requests', async () => {
      await runInReactCacheScope(() => renderProfileForViewer(PROFILE_HANDLE))
      await runInReactCacheScope(() => renderProfileForViewer(PROFILE_HANDLE))

      expect(viewerFollowCalls(PROFILE_ACTOR_ID)).toHaveLength(2)
    })

    // Every other case here seeds an Accepted follow, so on their own they only
    // ever prove the permissive branch: an audience that returned
    // `includeFollowersOnly: true` unconditionally would satisfy all of them.
    // Pin the deny outcome through the same memoized path — this is the surface
    // that served followers-only posts and direct messages to anyone before
    // #1510, so a wrong answer here is a privacy bug, not a slow page.
    it('withholds followers-only statuses from a viewer whose follow is only requested', async () => {
      mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
        id: 'follow-id',
        actorId: VIEWER_ACTOR_ID,
        targetActorId: PROFILE_ACTOR_ID,
        status: FollowStatus.enum.Requested
      })

      await runInReactCacheScope(() => renderProfileForViewer(PROFILE_HANDLE))

      expect(mockDatabase.getActorStatuses).toHaveBeenCalledWith(
        expect.objectContaining({ includeFollowersOnly: false })
      )
      // Still one lookup: the memoization is unchanged by the answer.
      expect(viewerFollowCalls(PROFILE_ACTOR_ID)).toHaveLength(1)
    })
  })

  // The remote branch resolves the actor from a FETCHED ActivityPub document
  // rather than a database row, so the id the audience lookup is keyed on and
  // the id the page hands `getRelationship` arrive by different routes. They
  // still have to be the same string for the two reads to collapse.
  describe('for a remote actor', () => {
    beforeEach(() => {
      mockDatabase.getActorFromUsername.mockResolvedValue(null)
      vi.mocked(getWebfingerSelf).mockResolvedValue(REMOTE_ACTOR_ID)
      vi.mocked(getFederationSigningActorSafe).mockResolvedValue(undefined)
      vi.mocked(getActorPerson).mockResolvedValue(remotePerson)
      vi.mocked(getActorPosts).mockResolvedValue({
        statuses: [],
        statusesCount: 0,
        nextPageUrl: null,
        prevPageUrl: null
      })
      vi.mocked(getActorCollectionCounts).mockResolvedValue({
        followersCount: 0,
        followingCount: 0,
        statusesCount: 0
      })
      mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
        id: 'follow-id',
        actorId: VIEWER_ACTOR_ID,
        targetActorId: REMOTE_ACTOR_ID,
        status: FollowStatus.enum.Accepted
      })
    })

    it('reads the viewer follow once for a signed-in non-owner profile view', async () => {
      const profile = await runInReactCacheScope(() =>
        renderProfileForViewer(REMOTE_HANDLE)
      )

      expect(profile.person.id).toBe(REMOTE_ACTOR_ID)
      expect(viewerFollowCalls(REMOTE_ACTOR_ID)).toHaveLength(1)
    })

    // A call count alone cannot tell "the two lookups collapsed into one" from
    // "the audience half never ran" — both leave exactly one. So pin what the
    // audience half produced as well, the way the local case does through
    // `getActorStatuses`. On this branch it is the attachment query that carries
    // the scope: `getActorPosts` reads the remote outbox, which is public by
    // construction. Without this, dropping the remote branch's audience
    // resolution entirely — an unscoped remote profile, the followers-only leak
    // this whole area exists to prevent — left every test here passing.
    it('scopes the remote gallery with the memoized follow row', async () => {
      await runInReactCacheScope(() => renderProfileForViewer(REMOTE_HANDLE))

      expect(mockDatabase.getAttachmentsForActor).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: REMOTE_ACTOR_ID,
          publicOnly: false,
          visibleToActorId: VIEWER_ACTOR_ID,
          includeFollowersOnly: true,
          followersAudience: `${REMOTE_ACTOR_ID}/followers`
        })
      )
    })

    it('withholds the remote gallery from a viewer whose follow is only requested', async () => {
      mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
        id: 'follow-id',
        actorId: VIEWER_ACTOR_ID,
        targetActorId: REMOTE_ACTOR_ID,
        status: FollowStatus.enum.Requested
      })

      await runInReactCacheScope(() => renderProfileForViewer(REMOTE_HANDLE))

      expect(mockDatabase.getAttachmentsForActor).toHaveBeenCalledWith(
        expect.objectContaining({ includeFollowersOnly: false })
      )
    })
  })
})

import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

import { getProfileData } from './getProfileData'

// Mock dependencies via Jest module name mapper aliases
vi.mock('@/lib/activities/getActorCollectionCounts')
vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')
vi.mock('@/lib/activities/getWebfingerSelf')
vi.mock('@/lib/services/federation/getFederationSigningActor')
vi.mock('@/lib/utils/getPersonFromActor')
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}))

describe('getProfileData', () => {
  const mockDatabase = {
    getActorFromUsername: vi.fn(),
    getActorStatuses: vi.fn(),
    getActorStatusesCount: vi.fn(),
    getAttachmentsForActor: vi.fn(),
    getActorFollowingCount: vi.fn(),
    getActorFollowersCount: vi.fn(),
    getActorHasFitnessData: vi.fn(),
    getAcceptedOrRequestedFollow: vi.fn(),
    setActorCounters: vi.fn(),
    updateActor: vi.fn()
  } as unknown as Database

  const mockLocalActor = {
    id: 'local-actor-id',
    username: 'localuser',
    domain: 'example.com',
    account: { email: 'user@example.com' }, // Has account, indicating local actor
    name: 'Local User',
    summary: 'A local user',
    iconUrl: 'https://example.com/icon.png',
    headerImageUrl: 'https://example.com/header.png'
  }

  const mockRemoteActor = {
    id: 'remote-actor-id',
    username: 'remoteuser',
    domain: 'remote.com',
    account: null, // No account, indicating remote actor
    name: 'Remote User',
    summary: 'A remote user'
  }

  const mockPerson: Actor = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Person',
    id: 'https://remote.com/users/remoteuser',
    preferredUsername: 'remoteuser',
    name: 'Remote User',
    summary: 'A remote user',
    inbox: 'https://remote.com/users/remoteuser/inbox',
    outbox: 'https://remote.com/users/remoteuser/outbox',
    followers: 'https://remote.com/users/remoteuser/followers',
    following: 'https://remote.com/users/remoteuser/following',
    publicKey: {
      id: 'https://remote.com/users/remoteuser#main-key',
      owner: 'https://remote.com/users/remoteuser',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
    }
  }

  // The dedicated headless instance actor used to sign server-to-server
  // federation fetches (never the viewer's user actor).
  const mockFederationSigningActor = {
    id: 'https://example.com/users/__instance__',
    type: 'Service',
    username: '__instance__',
    domain: 'example.com',
    privateKey: 'instance-private-key'
  } as unknown as DomainActor

  const mockStatuses: Status[] = []
  const mockAttachments: Attachment[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    ;(mockDatabase.getActorStatuses as jest.Mock).mockResolvedValue(
      mockStatuses
    )
    ;(mockDatabase.getActorStatusesCount as jest.Mock).mockResolvedValue(0)
    ;(mockDatabase.getAttachmentsForActor as jest.Mock).mockResolvedValue(
      mockAttachments
    )
    ;(mockDatabase.getActorFollowingCount as jest.Mock).mockResolvedValue(10)
    ;(mockDatabase.getActorFollowersCount as jest.Mock).mockResolvedValue(20)
    ;(mockDatabase.getActorHasFitnessData as jest.Mock).mockResolvedValue(false)
    ;(mockDatabase.setActorCounters as jest.Mock).mockResolvedValue(undefined)
    ;(mockDatabase.getAcceptedOrRequestedFollow as jest.Mock).mockResolvedValue(
      null
    )
    ;(getPersonFromActor as jest.Mock).mockReturnValue(mockPerson)
  })

  describe('when actor is local (has account)', () => {
    beforeEach(() => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(
        mockLocalActor
      )
    })

    it('should return profile data for logged in user', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@localuser@example.com',
        true,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      expect(result?.isInternalAccount).toBe(true)
      expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
        username: 'localuser',
        domain: 'example.com'
      })
      // Should not call remote APIs
      expect(getWebfingerSelf).not.toHaveBeenCalled()
      expect(getActorPerson).not.toHaveBeenCalled()
    })

    it('should return profile data for anonymous user', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@localuser@example.com',
        false,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      expect(result?.isInternalAccount).toBe(true)
      expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
        username: 'localuser',
        domain: 'example.com'
      })
      // Should not call remote APIs
      expect(getWebfingerSelf).not.toHaveBeenCalled()
      expect(getActorPerson).not.toHaveBeenCalled()
    })

    it('should return hasFitnessData as false when actor has no fitness data', async () => {
      ;(mockDatabase.getActorHasFitnessData as jest.Mock).mockResolvedValue(
        false
      )
      const result = await getProfileData(
        mockDatabase,
        '@localuser@example.com',
        true,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      expect(result?.hasFitnessData).toBe(false)
    })

    it('should return hasFitnessData as true when actor has fitness data', async () => {
      ;(mockDatabase.getActorHasFitnessData as jest.Mock).mockResolvedValue(
        true
      )
      const result = await getProfileData(
        mockDatabase,
        '@localuser@example.com',
        true,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      expect(result?.hasFitnessData).toBe(true)
    })

    // The profile page used to call getActorStatuses with only currentActorId,
    // which is hydration-only. With none of publicOnly/visibleToActorId/
    // includeFollowersOnly set, the query applies no visibility predicate at
    // all, so a logged-out visitor's profile page server-rendered the actor's
    // followers-only posts and direct messages — and getAttachmentsForActor,
    // called the same way, put those posts' images in the Media tab.
    //
    // These assert the ARGUMENTS rather than the rows because the defect was a
    // missing argument: the database layer was behaving exactly as asked.
    describe('status and attachment visibility', () => {
      const followersUrl = 'https://example.com/users/localuser/followers'
      const localActorWithFollowers = {
        ...mockLocalActor,
        followersUrl
      }

      const viewer = {
        id: 'viewer-actor-id',
        username: 'viewer',
        domain: 'example.com'
      } as unknown as DomainActor

      const owner = {
        id: mockLocalActor.id,
        username: 'localuser',
        domain: 'example.com'
      } as unknown as DomainActor

      beforeEach(() => {
        ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(
          localActorWithFollowers
        )
      })

      const visibilityArgsFor = (mock: jest.Mock) => {
        const [args] = mock.mock.calls.at(-1) as [Record<string, unknown>]
        return {
          publicOnly: args.publicOnly,
          visibleToActorId: args.visibleToActorId,
          includeFollowersOnly: args.includeFollowersOnly,
          followersAudience: args.followersAudience
        }
      }

      it('restricts a logged-out visitor to publicly readable statuses', async () => {
        await getProfileData(mockDatabase, '@localuser@example.com', false, {
          currentActor: null
        })

        expect(
          visibilityArgsFor(mockDatabase.getActorStatuses as jest.Mock)
        ).toEqual({
          publicOnly: true,
          visibleToActorId: null,
          includeFollowersOnly: false,
          followersAudience: followersUrl
        })
      })

      it('restricts a logged-out visitor to publicly readable attachments', async () => {
        await getProfileData(mockDatabase, '@localuser@example.com', false, {
          currentActor: null
        })

        expect(
          visibilityArgsFor(mockDatabase.getAttachmentsForActor as jest.Mock)
        ).toEqual({
          publicOnly: true,
          visibleToActorId: null,
          includeFollowersOnly: false,
          followersAudience: followersUrl
        })
      })

      it('scopes a signed-in non-follower to what is addressed to them', async () => {
        await getProfileData(mockDatabase, '@localuser@example.com', true, {
          currentActor: viewer
        })

        expect(
          visibilityArgsFor(mockDatabase.getActorStatuses as jest.Mock)
        ).toEqual({
          publicOnly: false,
          visibleToActorId: viewer.id,
          includeFollowersOnly: false,
          followersAudience: followersUrl
        })
      })

      it('admits followers-only statuses once the viewer follows the actor', async () => {
        ;(
          mockDatabase.getAcceptedOrRequestedFollow as jest.Mock
        ).mockResolvedValue({ status: FollowStatus.enum.Accepted })

        await getProfileData(mockDatabase, '@localuser@example.com', true, {
          currentActor: viewer
        })

        expect(
          visibilityArgsFor(mockDatabase.getActorStatuses as jest.Mock)
        ).toEqual({
          publicOnly: false,
          visibleToActorId: viewer.id,
          includeFollowersOnly: true,
          followersAudience: followersUrl
        })
      })

      it('keeps a requested-but-not-accepted follow out of the followers audience', async () => {
        ;(
          mockDatabase.getAcceptedOrRequestedFollow as jest.Mock
        ).mockResolvedValue({ status: FollowStatus.enum.Requested })

        await getProfileData(mockDatabase, '@localuser@example.com', true, {
          currentActor: viewer
        })

        expect(
          visibilityArgsFor(mockDatabase.getActorStatuses as jest.Mock)
            .includeFollowersOnly
        ).toBe(false)
      })

      // All three visibility arguments falsy is what makes the query unfiltered,
      // which is how the owner sees their own private posts. It is the one case
      // that must NOT be narrowed.
      it('leaves the owner viewing their own profile unfiltered', async () => {
        await getProfileData(mockDatabase, '@localuser@example.com', true, {
          currentActor: owner
        })

        expect(
          visibilityArgsFor(mockDatabase.getActorStatuses as jest.Mock)
        ).toEqual({
          publicOnly: false,
          visibleToActorId: null,
          includeFollowersOnly: false,
          followersAudience: followersUrl
        })
        expect(mockDatabase.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
      })

      it('still hydrates viewer interaction state from the signed-in actor', async () => {
        await getProfileData(mockDatabase, '@localuser@example.com', true, {
          currentActor: viewer
        })

        expect(mockDatabase.getActorStatuses).toHaveBeenCalledWith(
          expect.objectContaining({ currentActorId: viewer.id })
        )
      })

      // Second layer: the SQL scope filters on a status's own recipients, which
      // cannot see through a boost. canActorReadStatus follows the announce
      // chain, so a status the query hands back anyway is still dropped.
      it('drops a status the query returned that the viewer may not read', async () => {
        const followersOnlyStatus = {
          id: 'https://example.com/users/localuser/statuses/secret',
          type: StatusType.enum.Note,
          actorId: mockLocalActor.id,
          to: [followersUrl],
          cc: [],
          text: 'followers only'
        } as unknown as Status
        ;(mockDatabase.getActorStatuses as jest.Mock).mockResolvedValue([
          followersOnlyStatus
        ])

        const result = await getProfileData(
          mockDatabase,
          '@localuser@example.com',
          false,
          { currentActor: null }
        )

        expect(result?.statuses).toEqual([])
      })
    })
  })

  describe('when actor is remote (no account)', () => {
    beforeEach(() => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(
        mockRemoteActor
      )
      ;(getWebfingerSelf as jest.Mock).mockResolvedValue(
        'https://remote.com/users/remoteuser'
      )
      ;(getActorPerson as jest.Mock).mockResolvedValue(mockPerson)
      ;(getActorPosts as jest.Mock).mockResolvedValue({
        statuses: mockStatuses,
        statusesCount: 0
      })
      ;(getActorCollectionCounts as jest.Mock).mockResolvedValue({
        followersCount: 20,
        followingCount: 10,
        statusesCount: 0
      })
      ;(getFederationSigningActorSafe as jest.Mock).mockResolvedValue(
        mockFederationSigningActor
      )
    })

    it('should return profile data for logged in user', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      expect(result?.isInternalAccount).toBe(false)
      expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
        username: 'remoteuser',
        domain: 'remote.com'
      })
      // Should call remote APIs
      expect(getWebfingerSelf).toHaveBeenCalledWith({
        account: 'remoteuser@remote.com'
      })
      expect(getActorPerson).toHaveBeenCalledWith({
        actorId: 'https://remote.com/users/remoteuser',
        signingActor: mockFederationSigningActor
      })
    })

    it('signs all remote federation fetches with the dedicated instance actor', async () => {
      // Remote actors hosted on authorized-fetch ("secure mode") instances
      // reject unsigned requests with 401. Federation fetches must therefore be
      // signed by the headless instance actor — never the viewer's user actor,
      // which may be absent or unservable — so the profile resolves instead of
      // 404ing. See getFederationSigningActor.
      await getProfileData(mockDatabase, '@remoteuser@remote.com', true, {
        currentActor: null
      })

      expect(getFederationSigningActorSafe).toHaveBeenCalledWith(
        mockDatabase,
        expect.any(String)
      )
      expect(getActorPerson).toHaveBeenCalledWith({
        actorId: 'https://remote.com/users/remoteuser',
        signingActor: mockFederationSigningActor
      })
      expect(getActorPosts).toHaveBeenCalledWith({
        database: mockDatabase,
        person: mockPerson,
        pageUrl: undefined,
        signingActor: mockFederationSigningActor
      })
      expect(getActorCollectionCounts).toHaveBeenCalledWith({
        person: mockPerson,
        signingActor: mockFederationSigningActor
      })
    })

    it('persists the fetched profile snapshot and collection counts for known actors', async () => {
      ;(getActorCollectionCounts as jest.Mock).mockResolvedValue({
        followersCount: 5370,
        followingCount: 519,
        statusesCount: null
      })

      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        { currentActor: null }
      )

      expect(result).toMatchObject({
        followersCount: 5370,
        followingCount: 519
      })
      // Same field set recordActorIfNeeded persists (getPersistableProfile),
      // so both refresh paths write consistent snapshots.
      expect(mockDatabase.updateActor).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: mockPerson.id,
          name: 'Remote User',
          summary: 'A remote user',
          manuallyApprovesFollowers: false,
          fields: []
        })
      )
      expect(mockDatabase.setActorCounters).toHaveBeenCalledWith({
        actorId: mockPerson.id,
        followersCount: 5370,
        followingCount: 519,
        statusCount: null
      })
    })

    it('passes the requested remote status page cursor to the outbox loader', async () => {
      await getProfileData(mockDatabase, '@remoteuser@remote.com', true, {
        statusPageUrl:
          'https://remote.com/users/remoteuser/outbox?page=true&max_id=1'
      })

      expect(getActorPosts).toHaveBeenCalledWith({
        database: mockDatabase,
        person: mockPerson,
        pageUrl:
          'https://remote.com/users/remoteuser/outbox?page=true&max_id=1',
        signingActor: mockFederationSigningActor
      })
    })

    // A remote actor's attachments are whatever their statuses brought here
    // when they federated in, which includes followers-only posts delivered to
    // a local follower. `getActorPosts` reads the remote outbox (public by
    // construction), so the attachment query is the only one that needs
    // scoping — and it is reached on a different branch from the local one, so
    // it needs its own coverage.
    it('scopes a remote actor gallery to what the viewer may read', async () => {
      const viewer = {
        id: 'viewer-actor-id',
        username: 'viewer',
        domain: 'example.com'
      } as unknown as DomainActor

      await getProfileData(mockDatabase, '@remoteuser@remote.com', true, {
        currentActor: viewer
      })

      expect(mockDatabase.getAttachmentsForActor).toHaveBeenCalledWith({
        actorId: mockPerson.id,
        publicOnly: false,
        visibleToActorId: viewer.id,
        includeFollowersOnly: false,
        followersAudience: mockPerson.followers
      })
    })

    it('restricts a remote actor gallery to public attachments with no viewer', async () => {
      await getProfileData(mockDatabase, '@remoteuser@remote.com', true, {
        currentActor: null
      })

      expect(mockDatabase.getAttachmentsForActor).toHaveBeenCalledWith(
        expect.objectContaining({
          publicOnly: true,
          visibleToActorId: null,
          includeFollowersOnly: false
        })
      )
    })

    it('should return hasFitnessData as false for remote actors', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      expect(result?.hasFitnessData).toBe(false)
    })

    it('should return null for anonymous user without calling remote APIs', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        false,
        { currentActor: null }
      )

      expect(result).toBeNull()
      expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
        username: 'remoteuser',
        domain: 'remote.com'
      })
      // Should NOT call expensive remote APIs — including the signer, so an
      // anonymous page view never resolves or provisions the instance actor.
      expect(getWebfingerSelf).not.toHaveBeenCalled()
      expect(getFederationSigningActorSafe).not.toHaveBeenCalled()
      expect(getActorPerson).not.toHaveBeenCalled()
      expect(getActorPosts).not.toHaveBeenCalled()
      expect(getActorCollectionCounts).not.toHaveBeenCalled()
    })

    it('omits the signing actor entirely when no instance actor is available', async () => {
      // getFederationSigningActorSafe owns the warn-and-degrade handling and
      // returns undefined when the instance actor could not be resolved. The
      // fetch must then fall back to an unsigned request (no `signingActor`
      // key at all) rather than passing `signingActor: undefined` downstream.
      ;(getFederationSigningActorSafe as jest.Mock).mockResolvedValue(undefined)

      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      const personCall = (getActorPerson as jest.Mock).mock.calls[0][0]
      expect(personCall).toEqual({
        actorId: 'https://remote.com/users/remoteuser'
      })
      expect('signingActor' in personCall).toBe(false)
      const postsCall = (getActorPosts as jest.Mock).mock.calls[0][0]
      expect('signingActor' in postsCall).toBe(false)
    })
  })

  describe('when actor does not exist', () => {
    beforeEach(() => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(null)
      ;(getWebfingerSelf as jest.Mock).mockResolvedValue(null)
    })

    it('should return null for logged in user', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@nonexistent@example.com',
        true,
        { currentActor: null }
      )

      expect(result).toBeNull()
      expect(getWebfingerSelf).toHaveBeenCalledWith({
        account: 'nonexistent@example.com'
      })
    })

    it('should return null for anonymous user', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@nonexistent@example.com',
        false,
        { currentActor: null }
      )

      expect(result).toBeNull()
      // Should not call remote APIs for anonymous user
      expect(getWebfingerSelf).not.toHaveBeenCalled()
    })
  })

  describe('default parameter behavior', () => {
    it('should default isLoggedIn to true for backward compatibility', async () => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(
        mockRemoteActor
      )
      ;(getWebfingerSelf as jest.Mock).mockResolvedValue(
        'https://remote.com/users/remoteuser'
      )
      ;(getActorPerson as jest.Mock).mockResolvedValue(mockPerson)
      ;(getActorPosts as jest.Mock).mockResolvedValue({
        statuses: mockStatuses,
        statusesCount: 0
      })
      ;(getActorCollectionCounts as jest.Mock).mockResolvedValue({
        followersCount: 20,
        followingCount: 10,
        statusesCount: 0
      })
      ;(getFederationSigningActorSafe as jest.Mock).mockResolvedValue(
        mockFederationSigningActor
      )

      // Call without isLoggedIn parameter
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        undefined,
        { currentActor: null }
      )

      expect(result).not.toBeNull()
      // Should have called remote APIs since default is true
      expect(getWebfingerSelf).toHaveBeenCalled()
    })
  })
})

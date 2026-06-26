import { getActorFollowers } from '@/lib/activities/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/getActorFollowing'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

import { getProfileData } from './getProfileData'

// Mock dependencies via Jest module name mapper aliases
vi.mock('@/lib/activities/getActorFollowers')
vi.mock('@/lib/activities/getActorFollowing')
vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')
vi.mock('@/lib/activities/getWebfingerSelf')
vi.mock('@/lib/services/federation/getFederationSigningActor')
vi.mock('@/lib/utils/getPersonFromActor')

describe('getProfileData', () => {
  const mockDatabase = {
    getActorFromUsername: vi.fn(),
    getActorStatuses: vi.fn(),
    getActorStatusesCount: vi.fn(),
    getAttachmentsForActor: vi.fn(),
    getActorFollowingCount: vi.fn(),
    getActorFollowersCount: vi.fn(),
    getActorHasFitnessData: vi.fn(),
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
        true
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
        false
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
        true
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
        true
      )

      expect(result).not.toBeNull()
      expect(result?.hasFitnessData).toBe(true)
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
      ;(getActorFollowing as jest.Mock).mockResolvedValue({
        followingCount: 10
      })
      ;(getActorFollowers as jest.Mock).mockResolvedValue({
        followerCount: 20
      })
      ;(getFederationSigningActor as jest.Mock).mockResolvedValue(
        mockFederationSigningActor
      )
    })

    it('should return profile data for logged in user', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true
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
      await getProfileData(mockDatabase, '@remoteuser@remote.com', true)

      expect(getFederationSigningActor).toHaveBeenCalledWith(mockDatabase)
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
      expect(getActorFollowing).toHaveBeenCalledWith({
        person: mockPerson,
        signingActor: mockFederationSigningActor
      })
      expect(getActorFollowers).toHaveBeenCalledWith({
        person: mockPerson,
        signingActor: mockFederationSigningActor
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

    it('should return hasFitnessData as false for remote actors', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true
      )

      expect(result).not.toBeNull()
      expect(result?.hasFitnessData).toBe(false)
    })

    it('should return null for anonymous user without calling remote APIs', async () => {
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        false
      )

      expect(result).toBeNull()
      expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
        username: 'remoteuser',
        domain: 'remote.com'
      })
      // Should NOT call expensive remote APIs
      expect(getWebfingerSelf).not.toHaveBeenCalled()
      expect(getActorPerson).not.toHaveBeenCalled()
      expect(getActorPosts).not.toHaveBeenCalled()
      expect(getActorFollowing).not.toHaveBeenCalled()
      expect(getActorFollowers).not.toHaveBeenCalled()
    })

    it('omits the signing actor entirely when no instance actor is available', async () => {
      // getFederationSigningActor returns undefined when the instance actor
      // could not be resolved/provisioned. The fetch must then fall back to an
      // unsigned request (no `signingActor` key at all) rather than passing
      // `signingActor: undefined` downstream. This locks in the `: {}` branch.
      ;(getFederationSigningActor as jest.Mock).mockResolvedValue(undefined)

      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true
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
        true
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
        false
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
      ;(getActorFollowing as jest.Mock).mockResolvedValue({
        followingCount: 10
      })
      ;(getActorFollowers as jest.Mock).mockResolvedValue({
        followerCount: 20
      })
      ;(getFederationSigningActor as jest.Mock).mockResolvedValue(
        mockFederationSigningActor
      )

      // Call without isLoggedIn parameter
      const result = await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com'
      )

      expect(result).not.toBeNull()
      // Should have called remote APIs since default is true
      expect(getWebfingerSelf).toHaveBeenCalled()
    })
  })
})

import { getActorFollowers } from '@/lib/activities/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/getActorFollowing'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { aliasServedLocalActor } from '@/lib/services/actors/aliasServedLocalActor'
import { Actor } from '@/lib/types/activitypub'
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
vi.mock('@/lib/services/actors/aliasServedLocalActor', () => ({
  aliasServedLocalActor: vi.fn()
}))
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

  const mockStatuses: Status[] = []
  const mockAttachments: Attachment[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    // Default the alias fallback to a miss; the alias tests opt into a hit.
    vi.mocked(aliasServedLocalActor).mockResolvedValue(null)
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
        actorId: 'https://remote.com/users/remoteuser'
      })
    })

    it('passes the requested remote status page cursor to the outbox loader', async () => {
      await getProfileData(
        mockDatabase,
        '@remoteuser@remote.com',
        true,
        undefined,
        {
          statusPageUrl:
            'https://remote.com/users/remoteuser/outbox?page=true&max_id=1'
        }
      )

      expect(getActorPosts).toHaveBeenCalledWith({
        database: mockDatabase,
        person: mockPerson,
        pageUrl: 'https://remote.com/users/remoteuser/outbox?page=true&max_id=1'
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

  describe('when actor is addressed via a trusted-host alias', () => {
    // The canonical local actor lives on canonical.example; the client addresses
    // it via the served alias host alias.example, where no actor row exists.
    const mockAliasResolvedActor = {
      id: 'canonical-actor-id',
      username: 'localuser',
      domain: 'canonical.example',
      account: { email: 'user@canonical.example' },
      privateKey: 'private-key',
      name: 'Local User'
    }

    it('resolves the canonical local actor and renders it as an internal account', async () => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(null)
      vi.mocked(aliasServedLocalActor).mockResolvedValue(
        mockAliasResolvedActor as unknown as Awaited<
          ReturnType<typeof aliasServedLocalActor>
        >
      )

      const result = await getProfileData(
        mockDatabase,
        '@localuser@alias.example',
        true
      )

      expect(result).not.toBeNull()
      expect(result?.isInternalAccount).toBe(true)
      expect(aliasServedLocalActor).toHaveBeenCalledWith({
        database: mockDatabase,
        username: 'localuser',
        domain: 'alias.example'
      })
      // The canonical actor id (not the alias query) drives the local lookups.
      expect(mockDatabase.getActorStatuses).toHaveBeenCalledWith({
        actorId: 'canonical-actor-id'
      })
      // Should not fall through to the remote-fetch path.
      expect(getWebfingerSelf).not.toHaveBeenCalled()
      expect(getActorPerson).not.toHaveBeenCalled()
    })

    it('resolves the alias for an anonymous viewer without remote calls', async () => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(null)
      vi.mocked(aliasServedLocalActor).mockResolvedValue(
        mockAliasResolvedActor as unknown as Awaited<
          ReturnType<typeof aliasServedLocalActor>
        >
      )

      const result = await getProfileData(
        mockDatabase,
        '@localuser@alias.example',
        false
      )

      expect(result).not.toBeNull()
      expect(result?.isInternalAccount).toBe(true)
      expect(getWebfingerSelf).not.toHaveBeenCalled()
    })

    it('falls through to the remote path when the alias fallback also misses', async () => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(null)
      vi.mocked(aliasServedLocalActor).mockResolvedValue(null)
      ;(getWebfingerSelf as jest.Mock).mockResolvedValue(null)

      const result = await getProfileData(
        mockDatabase,
        '@localuser@alias.example',
        true
      )

      expect(result).toBeNull()
      expect(aliasServedLocalActor).toHaveBeenCalledWith({
        database: mockDatabase,
        username: 'localuser',
        domain: 'alias.example'
      })
      expect(getWebfingerSelf).toHaveBeenCalledWith({
        account: 'localuser@alias.example'
      })
    })

    it('does not consult the alias fallback when the strict lookup finds a local actor', async () => {
      ;(mockDatabase.getActorFromUsername as jest.Mock).mockResolvedValue(
        mockLocalActor
      )

      const result = await getProfileData(
        mockDatabase,
        '@localuser@example.com',
        true
      )

      expect(result?.isInternalAccount).toBe(true)
      expect(aliasServedLocalActor).not.toHaveBeenCalled()
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

import { Actor } from '@llun/activities.schema'

import { getActorFollowers } from '@/lib/activities/requests/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/requests/getActorFollowing'
import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
import { getActorPosts } from '@/lib/activities/requests/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/requests/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { Attachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

import { getProfileData } from './getProfileData'

// Mock dependencies - use relative paths for jest.mock()
jest.mock('../../../lib/activities/requests/getActorFollowers')
jest.mock('../../../lib/activities/requests/getActorFollowing')
jest.mock('../../../lib/activities/requests/getActorPerson')
jest.mock('../../../lib/activities/requests/getActorPosts')
jest.mock('../../../lib/activities/requests/getWebfingerSelf')
jest.mock('../../../lib/utils/getPersonFromActor')

describe('getProfileData', () => {
  const mockDatabase = {
    getActorFromUsername: jest.fn(),
    getActorStatuses: jest.fn(),
    getActorStatusesCount: jest.fn(),
    getAttachmentsForActor: jest.fn(),
    getActorFollowingCount: jest.fn(),
    getActorFollowersCount: jest.fn(),
    updateActor: jest.fn()
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
    jest.clearAllMocks()
    ;(mockDatabase.getActorStatuses as jest.Mock).mockResolvedValue(
      mockStatuses
    )
    ;(mockDatabase.getActorStatusesCount as jest.Mock).mockResolvedValue(0)
    ;(mockDatabase.getAttachmentsForActor as jest.Mock).mockResolvedValue(
      mockAttachments
    )
    ;(mockDatabase.getActorFollowingCount as jest.Mock).mockResolvedValue(10)
    ;(mockDatabase.getActorFollowersCount as jest.Mock).mockResolvedValue(20)
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

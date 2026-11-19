import { Database } from '@/lib/database/types'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { Actor } from '@/lib/types/domain/actor'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { undoFollow } from './unfollowActor'

const mockUnfollow = vi.fn()
const mockCanFederateWithDomain = vi.fn()
const mockGetFederationSigningActor = vi.fn()
const mockPublish = vi.fn()
const mockUpdateFollowStatus = vi.fn()

vi.mock('@/lib/activities', () => ({
  unfollow: (...params: unknown[]) => mockUnfollow(...params)
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: (...params: unknown[]) =>
    mockGetFederationSigningActor(...params)
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: (...params: unknown[]) => mockPublish(...params)
  })
}))

const database = {
  updateFollowStatus: (...params: unknown[]) =>
    mockUpdateFollowStatus(...params)
} as unknown as Database

const currentActor = {
  id: 'https://llun.test/users/llun',
  domain: 'llun.test'
} as unknown as Actor

const signingActor = {
  id: 'https://llun.test/users/__instance__',
  type: 'Service',
  username: '__instance__',
  domain: 'llun.test',
  privateKey: 'instance-key'
} as unknown as Actor

const follow: Follow = {
  id: 'follow-1',
  actorId: currentActor.id,
  actorHost: 'llun.test',
  targetActorId: 'https://remote.test/users/alice',
  targetActorHost: 'remote.test',
  status: FollowStatus.enum.Accepted,
  inbox: 'https://remote.test/users/alice/inbox',
  reblogs: true,
  notify: false,
  languages: null,
  createdAt: 1,
  updatedAt: 1
}

describe('undoFollow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateFollowStatus.mockResolvedValue(undefined)
    mockPublish.mockResolvedValue(undefined)
    mockGetFederationSigningActor.mockResolvedValue(signingActor)
  })

  it('undoes locally and queues the Undo when federation policy is unavailable', async () => {
    mockCanFederateWithDomain.mockRejectedValue(
      new FederationPolicyUnavailableError()
    )

    await expect(
      undoFollow(database, currentActor, follow)
    ).resolves.toBeUndefined()

    expect(mockUpdateFollowStatus).toHaveBeenCalledWith({
      followId: follow.id,
      status: FollowStatus.enum.Undo
    })
    expect(mockPublish).toHaveBeenCalledWith({
      id: getHashFromString(`${follow.id}/undo`),
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: { actorId: follow.actorId, follow }
    })
    expect(mockUnfollow).not.toHaveBeenCalled()
  })

  it('undoes locally and sends nothing when federation policy refuses the domain', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    await expect(
      undoFollow(database, currentActor, follow)
    ).resolves.toBeUndefined()

    expect(mockUpdateFollowStatus).toHaveBeenCalledWith({
      followId: follow.id,
      status: FollowStatus.enum.Undo
    })
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockUnfollow).not.toHaveBeenCalled()
  })

  it('sends the Undo directly when federation policy allows the domain', async () => {
    mockCanFederateWithDomain.mockResolvedValue(true)

    await expect(
      undoFollow(database, currentActor, follow)
    ).resolves.toBeUndefined()

    expect(mockUnfollow).toHaveBeenCalledWith(
      currentActor,
      follow,
      signingActor
    )
    expect(mockUpdateFollowStatus).toHaveBeenCalledWith({
      followId: follow.id,
      status: FollowStatus.enum.Undo
    })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('still resolves when queueing the Undo fails', async () => {
    mockCanFederateWithDomain.mockRejectedValue(
      new FederationPolicyUnavailableError()
    )
    mockPublish.mockRejectedValue(new Error('queue down'))
    const warn = vi.spyOn(logger, 'warn')

    try {
      await expect(
        undoFollow(database, currentActor, follow)
      ).resolves.toBeUndefined()

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Failed to queue an Undo Follow while federation policy is unavailable',
          followId: follow.id
        })
      )
      expect(mockUpdateFollowStatus).toHaveBeenCalledWith({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })
    } finally {
      warn.mockRestore()
    }
  })
})

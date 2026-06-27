/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'

import Page from './page'
import { resolveStatusFromPath } from './resolveStatusFromPath'

vi.mock('next/navigation', async () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
}))

vi.mock('@/lib/config', async () => ({
  getConfig: vi.fn(() => ({
    host: 'activities.local',
    fitnessStorage: undefined,
    mediaStorage: undefined,
    registrationOpen: false
  }))
}))

const mockGetStatus = vi.fn()
const mockGetStatusReplies = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: vi.fn(() => ({
    getStatus: mockGetStatus,
    getStatusReplies: mockGetStatusReplies
  }))
}))

vi.mock('@/lib/activities/getRemoteStatus', async () => ({
  getRemoteStatus: vi.fn()
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', async () => ({
  getFederationSigningActor: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', async () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', async () => ({
  getPublicMapboxAccessToken: vi.fn(() => undefined)
}))

vi.mock('@/lib/utils/logger', async () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('./resolveStatusFromPath', async () => ({
  ...(await vi.importActual('./resolveStatusFromPath')),
  resolveStatusFromPath: vi.fn()
}))

vi.mock('./Header', async () => ({ Header: () => null }))
vi.mock('./RemoteStatusLoading', async () => ({
  RemoteStatusLoading: () => null
}))
vi.mock('./SignInCallout', async () => ({ SignInCallout: () => null }))
vi.mock('./StatusStatStrip', async () => ({ StatusStatStrip: () => null }))
vi.mock('./StatusBox', async () => ({ StatusBox: () => null }))

const mockResolveStatusFromPath = vi.mocked(resolveStatusFromPath)
const mockGetRemoteStatus = vi.mocked(getRemoteStatus)
const mockGetFederationSigningActor = vi.mocked(getFederationSigningActor)
const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockGetQueue = vi.mocked(getQueue)

const REMOTE_STATUS_URL =
  'https://social.amsterdam.nl/users/gemeenteamsterdam/statuses/123'

// The dedicated headless instance actor used to sign server-to-server
// federation fetches — never the viewer's user actor.
const instanceActor = {
  id: 'https://activities.local/users/__instance__',
  type: 'Service',
  username: '__instance__',
  domain: 'activities.local',
  privateKey: 'instance-private-key'
} as unknown as Actor

// A logged-in viewer that resolves to a usable local actor. It must NOT be the
// signer for federation fetches even when present.
const buildViewer = (): Actor =>
  ({
    id: 'https://activities.local/users/viewer',
    type: 'Person',
    username: 'viewer',
    domain: 'activities.local',
    followersUrl: 'https://activities.local/users/viewer/followers',
    inboxUrl: 'https://activities.local/users/viewer/inbox',
    sharedInboxUrl: 'https://activities.local/inbox',
    publicKey: 'public-key',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: 1,
    updatedAt: 1
  }) as unknown as Actor

const buildRemoteNote = (): Status =>
  ({
    id: REMOTE_STATUS_URL,
    type: 'Note',
    actorId: 'https://social.amsterdam.nl/users/gemeenteamsterdam',
    actor: null,
    url: REMOTE_STATUS_URL,
    text: 'body',
    reply: '',
    replies: [],
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: false,
    isActorLiked: false,
    isActorBookmarked: false,
    actorAnnounceStatusId: null,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1
  }) as unknown as Status

const renderRemoteStatusPage = async () => {
  const element = await Page({
    params: Promise.resolve({
      actor: '@gemeenteamsterdam@social.amsterdam.nl',
      status: '123'
    })
  })
  render(element)
}

describe('Page remote-status fetch signing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    // A logged-in viewer with a usable local actor is present; the federation
    // fetch must still be signed by the instance actor, not this viewer.
    mockGetServerAuthSession.mockResolvedValue({} as never)
    mockGetActorFromSession.mockResolvedValue(buildViewer())
    mockGetStatusReplies.mockResolvedValue([])
    mockGetQueue.mockReturnValue({
      publish: vi.fn().mockResolvedValue(undefined),
      runsInline: false
    } as never)
    // The status is not in our database, so the page live-fetches it.
    mockResolveStatusFromPath.mockResolvedValue({
      status: null,
      statusId: '',
      fullStatusId: REMOTE_STATUS_URL,
      isStatusHash: false
    })
    mockGetRemoteStatus.mockResolvedValue(buildRemoteNote())
  })

  it('signs the remote status fetch with the instance actor, not the viewer', async () => {
    // Posts hosted on authorized-fetch ("secure mode") instances reject
    // unsigned/unverifiable fetches, so the live fetch must be signed by the
    // headless instance actor — never the viewer's user actor, which may be
    // absent or unservable. Otherwise the post 404s.
    mockGetFederationSigningActor.mockResolvedValue(instanceActor)

    await renderRemoteStatusPage()

    expect(mockGetFederationSigningActor).toHaveBeenCalledWith(
      expect.anything()
    )
    expect(mockGetRemoteStatus).toHaveBeenCalledWith({
      statusId: REMOTE_STATUS_URL,
      signingActor: instanceActor
    })
  })

  it('falls back to an unsigned fetch when the signer resolution rejects', async () => {
    // A transient instance-actor failure must not crash the render: the signer
    // resolves best-effort, so a rejection degrades to an unsigned fetch
    // instead of a 500.
    mockGetFederationSigningActor.mockRejectedValue(
      new Error('signer unavailable')
    )

    await renderRemoteStatusPage()

    const call = mockGetRemoteStatus.mock.calls[0][0]
    expect(call.statusId).toBe(REMOTE_STATUS_URL)
    expect(call.signingActor).toBeUndefined()
    // The failure is surfaced (not silently swallowed) so a persistently broken
    // signer stays diagnosable.
    expect(logger.warn).toHaveBeenCalled()
  })

  it('falls back to an unsigned fetch when no instance actor is available', async () => {
    // getFederationSigningActor returns undefined when the instance actor could
    // not be resolved/provisioned; the fetch then degrades to an unsigned
    // request rather than signing as the viewer.
    mockGetFederationSigningActor.mockResolvedValue(undefined)

    await renderRemoteStatusPage()

    const call = mockGetRemoteStatus.mock.calls[0][0]
    expect(call.statusId).toBe(REMOTE_STATUS_URL)
    expect(call.signingActor).toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

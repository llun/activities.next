/**
 * @vitest-environment jsdom
 * @vitest-size medium
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import { notFound, redirect } from 'next/navigation'

import { getNote } from '@/lib/activities'
import { recordRemoteActorBestEffort } from '@/lib/services/actors/refreshRemoteActor'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { PagedStatusThread } from './PagedStatusThread'
import Page from './page'

vi.mock('@/lib/services/domains/visitedSignUpDomain', () => ({
  getVisitedSignUpDomain: vi.fn(async () => ({
    domain: 'activities.local',
    displayName: 'Activities',
    source: 'primary',
    open: false,
    allowEmails: []
  }))
}))

vi.mock('next/navigation', async () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: vi.fn(() => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn()
  }))
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn(() => 'https://activities.local'),
  getConfig: vi.fn(() => ({
    host: 'activities.local',
    fitnessStorage: undefined,
    mediaStorage: undefined,
    registrationOpen: false
  }))
}))

const mockGetActorFromUsername = vi.fn()
const mockGetActorFromId = vi.fn()
const mockGetStatus = vi.fn()
const mockGetStatusFromUrlHash = vi.fn()
const mockGetStatusFromPublicId = vi.fn()
const mockGetStatusReplies = vi.fn()
const mockGetStatusReplyRefs = vi.fn()
const mockGetActorDomainBlocks = vi.fn(async () => [])
const mockGetFederationSigningActor = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: vi.fn(() => ({
    getActorFromUsername: mockGetActorFromUsername,
    getActorFromId: mockGetActorFromId,
    getStatus: mockGetStatus,
    getStatusFromUrlHash: mockGetStatusFromUrlHash,
    getStatusFromPublicId: mockGetStatusFromPublicId,
    getStatusReplies: mockGetStatusReplies,
    getStatusReplyRefs: mockGetStatusReplyRefs,
    getActorDomainBlocks: mockGetActorDomainBlocks,
    getFederationSigningActor: mockGetFederationSigningActor
  }))
}))

vi.mock('@/lib/activities', async () => ({
  getNote: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', async () => ({
  isLocalFederationDomain: vi.fn(),
  canFederateWithDomain: vi.fn()
}))

vi.mock('@/lib/services/actors/refreshRemoteActor', async () => ({
  recordRemoteActorBestEffort: vi.fn()
}))

vi.mock('@/lib/services/medias/animationMetadata', async () => ({
  enrichStatusAttachments: vi.fn(async (status: unknown) => status)
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

vi.mock('@/lib/config/mapProvider', async () => ({
  getMapProviderConfig: vi.fn(() => ({ type: 'osm' })),
  getPublicMapProvider: vi.fn(() => ({ type: 'osm' }))
}))

vi.mock('@/lib/utils/logger', async () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('./Header', async () => ({ Header: () => null }))
vi.mock('./RemoteStatusLoading', async () => ({
  RemoteStatusLoading: () => null
}))
vi.mock('./SignInCallout', async () => ({ SignInCallout: () => null }))
vi.mock('./StatusBox', async () => ({ StatusBox: () => null }))
vi.mock('./StatusLikes', async () => ({ StatusLikes: () => null }))
vi.mock('./PagedStatusThread', async () => ({
  PagedStatusThread: vi.fn(() => null)
}))

const mockGetNote = vi.mocked(getNote)
const mockIsLocalFederationDomain = vi.mocked(isLocalFederationDomain)
const mockCanFederateWithDomain = vi.mocked(canFederateWithDomain)
const mockRecordRemoteActorBestEffort = vi.mocked(recordRemoteActorBestEffort)
const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockGetQueue = vi.mocked(getQueue)
const mockNotFound = vi.mocked(notFound)
const mockRedirect = vi.mocked(redirect)

const LOCAL_ADMIN_ID = 'https://activities.local/users/admin'
const LOCAL_ADMIN = {
  id: LOCAL_ADMIN_ID,
  username: 'admin',
  domain: 'activities.local',
  name: 'Local Admin',
  followersUrl: `${LOCAL_ADMIN_ID}/followers`,
  inboxUrl: `${LOCAL_ADMIN_ID}/inbox`,
  sharedInboxUrl: 'https://activities.local/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'admin-public-key'
} as unknown as Actor

const REMOTE_AUTHOR_ID = 'https://remote.example/users/bob'
const REMOTE_STATUS_ID = 'https://remote.example/users/bob/statuses/1'
const REMOTE_ALIAS_URL = 'https://remote.example/@bob/1'
const REMOTE_AUTHOR = {
  id: REMOTE_AUTHOR_ID,
  username: 'bob',
  domain: 'remote.example',
  name: 'Bob Remote',
  followersUrl: `${REMOTE_AUTHOR_ID}/followers`,
  inboxUrl: `${REMOTE_AUTHOR_ID}/inbox`,
  sharedInboxUrl: 'https://remote.example/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'bob-public-key'
} as unknown as Actor

const INSTANCE_ACTOR = {
  id: 'https://activities.local/users/__instance__',
  type: 'Service',
  username: '__instance__',
  domain: 'activities.local',
  privateKey: 'instance-private-key'
} as unknown as Actor

const makeRemoteNote = (overrides: Record<string, unknown> = {}) => ({
  id: REMOTE_STATUS_ID,
  type: 'Note',
  attributedTo: REMOTE_AUTHOR_ID,
  content: '<p>Legitimate remote post</p>',
  published: '2026-01-01T00:00:00Z',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  ...overrides
})

const mockPublish = vi.fn()

describe('Page live-fetch security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Logged-out visitor by default (live-fetch viewing stays allowed for
    // logged-out visitors, with federation policy and origin gates enforced).
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetActorFromUsername.mockImplementation(
      async ({ username, domain }: { username: string; domain: string }) => {
        if (username === 'admin' && domain === 'activities.local') {
          return LOCAL_ADMIN
        }
        return undefined
      }
    )
    mockGetActorFromId.mockImplementation(async ({ id }: { id: string }) => {
      if (id === LOCAL_ADMIN_ID) return LOCAL_ADMIN
      if (id === REMOTE_AUTHOR_ID) return REMOTE_AUTHOR
      return undefined
    })
    mockGetStatus.mockResolvedValue(null)
    mockGetStatusFromUrlHash.mockResolvedValue(null)
    mockGetStatusFromPublicId.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])
    mockGetStatusReplyRefs.mockResolvedValue([])
    mockGetFederationSigningActor.mockResolvedValue(INSTANCE_ACTOR)
    mockRecordRemoteActorBestEffort.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockImplementation(
      async (_db, value: string) => {
        try {
          return new URL(value).host === 'activities.local'
        } catch {
          return false
        }
      }
    )
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockPublish.mockResolvedValue(undefined)
    mockGetQueue.mockReturnValue({
      publish: mockPublish,
      runsInline: false
    } as never)
  })

  it('refuses a remote note with forged attributedTo pointing at a local admin', async () => {
    const evilUrl = 'https://evil.example/n'
    mockGetNote.mockResolvedValue(
      makeRemoteNote({
        id: evilUrl,
        attributedTo: LOCAL_ADMIN_ID,
        content: '<p>Security notice: re-login at evil.example</p>'
      }) as never
    )

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@admin@activities.local',
          status: encodeURIComponent(evilUrl)
        })
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalled()
    expect(PagedStatusThread).not.toHaveBeenCalled()
    expect(mockGetActorFromId).not.toHaveBeenCalled()
    expect(mockRecordRemoteActorBestEffort).not.toHaveBeenCalled()
  })

  it('refuses a remote note whose id is on another origin than the requested URL', async () => {
    const requestedUrl = 'https://evil.example/forged-id'
    mockGetNote.mockResolvedValue(
      makeRemoteNote({
        id: REMOTE_STATUS_ID,
        attributedTo: REMOTE_AUTHOR_ID
      }) as never
    )

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@bob@remote.example',
          status: encodeURIComponent(requestedUrl)
        })
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalled()
    expect(PagedStatusThread).not.toHaveBeenCalled()
    expect(mockGetActorFromId).not.toHaveBeenCalled()
  })

  it('refuses a URL on a blocked domain without fetching', async () => {
    const blockedUrl = 'https://blocked.example/users/mallory/statuses/1'
    mockCanFederateWithDomain.mockResolvedValue(false)

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@mallory@blocked.example',
          status: encodeURIComponent(blockedUrl)
        })
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(PagedStatusThread).not.toHaveBeenCalled()
  })

  it('does not live-fetch or queue a blocked domain even for a signed-in viewer', async () => {
    const blockedUrl = 'https://blocked.example/users/mallory/statuses/1'
    mockGetServerAuthSession.mockResolvedValue({} as never)
    mockGetActorFromSession.mockResolvedValue(LOCAL_ADMIN)
    mockCanFederateWithDomain.mockResolvedValue(false)

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@mallory@blocked.example',
          status: encodeURIComponent(blockedUrl)
        })
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('does not live-fetch a local-domain URL', async () => {
    const localUrl = 'https://activities.local/users/admin/statuses/missing'

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@admin@activities.local',
          status: encodeURIComponent(localUrl)
        })
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(PagedStatusThread).not.toHaveBeenCalled()
  })

  it('refuses a non-public remote note without hydrating its author', async () => {
    mockGetNote.mockResolvedValue(
      makeRemoteNote({
        to: [`${REMOTE_AUTHOR_ID}/followers`],
        cc: []
      }) as never
    )

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@bob@remote.example',
          status: encodeURIComponent(REMOTE_STATUS_ID)
        })
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockGetActorFromId).not.toHaveBeenCalled()
    expect(mockRecordRemoteActorBestEffort).not.toHaveBeenCalled()
    expect(PagedStatusThread).not.toHaveBeenCalled()
  })

  it('renders a legitimate remote note whose author matches the path for a logged-out visitor', async () => {
    mockGetNote.mockResolvedValue(makeRemoteNote() as never)

    const element = await Page({
      params: Promise.resolve({
        actor: '@bob@remote.example',
        status: encodeURIComponent(REMOTE_STATUS_ID)
      })
    })
    render(element)

    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: REMOTE_STATUS_ID,
      signingActor: INSTANCE_ACTOR
    })
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(PagedStatusThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(PagedStatusThread).mock.calls[0][0]).toMatchObject({
      status: expect.objectContaining({
        id: REMOTE_STATUS_ID,
        actorId: REMOTE_AUTHOR_ID,
        actor: expect.objectContaining({
          username: 'bob',
          domain: 'remote.example'
        })
      })
    })
  })

  it('renders a legitimate remote note fetched via a same-origin canonical alias', async () => {
    mockGetNote.mockResolvedValue(makeRemoteNote() as never)

    const element = await Page({
      params: Promise.resolve({
        actor: '@bob@remote.example',
        status: encodeURIComponent(REMOTE_ALIAS_URL)
      })
    })
    render(element)

    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: REMOTE_ALIAS_URL,
      signingActor: INSTANCE_ACTOR
    })
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(PagedStatusThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(PagedStatusThread).mock.calls[0][0]).toMatchObject({
      status: expect.objectContaining({
        id: REMOTE_STATUS_ID,
        actorId: REMOTE_AUTHOR_ID
      })
    })
  })

  it('redirects to the verified author canonical path when the note author differs from the path actor', async () => {
    mockGetNote.mockResolvedValue(makeRemoteNote() as never)
    const expectedCanonicalPath = `/@bob@remote.example/${encodeURIComponent(REMOTE_STATUS_ID)}`

    await expect(
      Page({
        params: Promise.resolve({
          actor: '@admin@activities.local',
          status: encodeURIComponent(REMOTE_STATUS_ID)
        })
      })
    ).rejects.toThrow(`NEXT_REDIRECT:${expectedCanonicalPath}`)

    expect(mockRedirect).toHaveBeenCalledWith(expectedCanonicalPath)
    expect(PagedStatusThread).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

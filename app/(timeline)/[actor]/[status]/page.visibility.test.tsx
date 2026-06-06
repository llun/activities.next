/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'
import { resolveStatusFromPath } from './resolveStatusFromPath'

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({
    host: 'activities.local',
    fitnessStorage: undefined,
    mediaStorage: undefined
  }))
}))

const mockGetStatus = jest.fn()
const mockGetStatusReplies = jest.fn()
const mockGetAcceptedOrRequestedFollow = jest.fn()

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn(() => ({
    getStatus: mockGetStatus,
    getStatusReplies: mockGetStatusReplies,
    getAcceptedOrRequestedFollow: mockGetAcceptedOrRequestedFollow
  }))
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn()
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn()
}))

jest.mock('@/lib/utils/mapbox', () => ({
  getPublicMapboxAccessToken: jest.fn(() => undefined)
}))

jest.mock('./resolveStatusFromPath', () => ({
  ...jest.requireActual('./resolveStatusFromPath'),
  resolveStatusFromPath: jest.fn()
}))

jest.mock('./Header', () => ({ Header: () => null }))
jest.mock('./RemoteStatusLoading', () => ({ RemoteStatusLoading: () => null }))

// Render each status as its id so we can assert which statuses reach the page.
jest.mock('./StatusBox', () => ({
  StatusBox: ({ status }: { status: { id: string } }) => (
    <div data-testid={`status-${status.id}`} />
  )
}))

const mockResolveStatusFromPath = jest.mocked(resolveStatusFromPath)
const mockGetServerAuthSession = jest.mocked(getServerAuthSession)
const mockGetActorFromSession = jest.mocked(getActorFromSession)

const VIEWER_ID = 'https://activities.local/users/viewer'
const AUTHOR_ID = 'https://activities.local/users/anna'

const buildNote = (overrides: Partial<Status> = {}): Status =>
  ({
    id: 'note-id',
    type: 'Note',
    actorId: AUTHOR_ID,
    actor: null,
    url: `${AUTHOR_ID}/statuses/note-id`,
    text: 'body',
    reply: '',
    replies: [],
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    isActorLiked: false,
    isActorBookmarked: false,
    actorAnnounceStatusId: null,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as unknown as Status

const buildViewer = (): Actor =>
  ({
    id: VIEWER_ID,
    type: 'Person',
    username: 'viewer',
    domain: 'activities.local',
    followersUrl: `${VIEWER_ID}/followers`,
    inboxUrl: `${VIEWER_ID}/inbox`,
    sharedInboxUrl: 'https://activities.local/inbox',
    publicKey: 'public-key',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: 1,
    updatedAt: 1
  }) as unknown as Actor

const renderPage = async () => {
  const element = await Page({
    params: Promise.resolve({
      actor: '@anna@activities.local',
      status: 'hash'
    })
  })
  render(element)
}

describe('Page visibility for logged-out visitors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])
  })

  it('does not render a followers-only ancestor of a public reply', async () => {
    const focused = buildNote({ id: 'public-reply', reply: 'private-parent' })
    const privateParent = buildNote({
      id: 'private-parent',
      reply: '',
      // followers-only: not addressed to the public collection
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(privateParent)

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(
      screen.queryByTestId('status-private-parent')
    ).not.toBeInTheDocument()
  })

  it('renders a public ancestor of a public reply', async () => {
    const focused = buildNote({ id: 'public-reply', reply: 'public-parent' })
    const publicParent = buildNote({
      id: 'public-parent',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(publicParent)

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(screen.getByTestId('status-public-parent')).toBeInTheDocument()
  })

  it('hides private replies and excludes them from the reply count', async () => {
    const focused = buildNote({ id: 'focused' })
    const publicReply = buildNote({ id: 'public-reply', reply: 'focused' })
    const privateReply = buildNote({
      id: 'private-reply',
      reply: 'focused',
      to: ['https://activities.local/users/bob/followers'],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    // getStatusReplies is mocked, so the in-page backstop filter is what must
    // drop the private reply here.
    mockGetStatusReplies.mockResolvedValue([publicReply, privateReply])

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(screen.queryByTestId('status-private-reply')).not.toBeInTheDocument()
    // The reply-count heading reflects only the visible (public) reply.
    expect(screen.getByText('Replies (1)')).toBeInTheDocument()
  })
})

describe('Page visibility for logged-in non-recipient viewers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue({} as never)
    mockGetActorFromSession.mockResolvedValue(buildViewer())
    mockGetStatusReplies.mockResolvedValue([])
    // Default: the viewer does not follow anyone.
    mockGetAcceptedOrRequestedFollow.mockResolvedValue(null)
  })

  it('does not render a followers-only ancestor the viewer cannot read', async () => {
    const focused = buildNote({ id: 'public-reply', reply: 'private-parent' })
    const privateParent = buildNote({
      id: 'private-parent',
      reply: '',
      // followers-only by another author the viewer does not follow
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(privateParent)

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(
      screen.queryByTestId('status-private-parent')
    ).not.toBeInTheDocument()
  })

  it('does not render a direct-message ancestor the viewer is not addressed in', async () => {
    const focused = buildNote({ id: 'public-reply', reply: 'dm-parent' })
    const dmParent = buildNote({
      id: 'dm-parent',
      reply: '',
      // direct message to someone other than the viewer
      to: ['https://activities.local/users/bob'],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(dmParent)

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(screen.queryByTestId('status-dm-parent')).not.toBeInTheDocument()
  })

  it('renders a followers-only ancestor when the viewer follows the author', async () => {
    const focused = buildNote({ id: 'public-reply', reply: 'followed-parent' })
    const followedParent = buildNote({
      id: 'followed-parent',
      reply: '',
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(followedParent)
    mockGetAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(screen.getByTestId('status-followed-parent')).toBeInTheDocument()
  })

  // Reply visibility for logged-in viewers is enforced by the database query
  // (`visibleToActorId`), which is unit-tested in lib/database/sql/status.test.ts
  // and correctly includes recipientless replies to the viewer's own posts. The
  // page-level guarantee is that it forwards the viewer id to that query.
  it('passes the viewer id to getStatusReplies so the query filters by visibility', async () => {
    const focused = buildNote({ id: 'focused' })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatusReplies.mockResolvedValue([])

    await renderPage()

    expect(mockGetStatusReplies).toHaveBeenCalledWith(
      expect.objectContaining({ visibleToActorId: VIEWER_ID })
    )
  })
})

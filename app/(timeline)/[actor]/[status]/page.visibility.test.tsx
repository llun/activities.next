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
// A remote author whose stored followers collection does NOT end in
// `/followers` — used to exercise the exact-match followers audience check.
const REMOTE_AUTHOR_ID = 'https://remote.example/users/anna'

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

const buildAnnounce = (
  originalStatus: Status,
  overrides: Partial<Status> = {}
): Status =>
  ({
    id: 'public-announce',
    type: 'Announce',
    actorId: 'https://activities.local/users/booster',
    actor: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: 1,
    updatedAt: 1,
    originalStatus,
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
    // clearAllMocks does not reset implementations; getStatus is only set by
    // individual ancestor tests, so reset it to avoid leaking across tests.
    mockGetStatus.mockReset()
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

  it('renders a multi-level public ancestor chain', async () => {
    const focused = buildNote({ id: 'public-reply', reply: 'public-parent' })
    const publicParent = buildNote({
      id: 'public-parent',
      reply: 'public-grandparent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const publicGrandparent = buildNote({
      id: 'public-grandparent',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockImplementation(async ({ statusId }) => {
      if (statusId === 'public-parent') return publicParent
      if (statusId === 'public-grandparent') return publicGrandparent
      return null
    })

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(screen.getByTestId('status-public-parent')).toBeInTheDocument()
    expect(screen.getByTestId('status-public-grandparent')).toBeInTheDocument()
  })

  it('queries getStatusReplies with publicOnly and without a viewer id', async () => {
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
      expect.objectContaining({ publicOnly: true })
    )
    expect(mockGetStatusReplies).toHaveBeenCalledWith(
      expect.not.objectContaining({ visibleToActorId: expect.anything() })
    )
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

  it('returns notFound for a public boost wrapping a private original', async () => {
    const privateOriginal = buildNote({
      id: 'private-original',
      to: ['https://activities.local/users/anna/followers'],
      cc: []
    })
    const announce = buildAnnounce(privateOriginal, {
      actorId: 'https://activities.local/users/anna'
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: announce,
      statusId: 'public-announce',
      fullStatusId:
        'https://activities.local/users/anna/statuses/private-original',
      isStatusHash: true
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders the logged-out fitness dashboard with an sr-only heading and stat strip', async () => {
    const focused = buildNote({
      id: 'fitness-status',
      fitness: {
        id: 'fit-1',
        fileName: 'run.fit',
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 1024,
        url: 'https://activities.local/fit/run.fit',
        processingStatus: 'completed'
      }
    } as unknown as Partial<Status>)

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'fitness-status',
      fullStatusId: focused.url,
      isStatusHash: true
    })

    await renderPage()

    // The back-button Header is gated to signed-in users; logged-out keeps only
    // a visually-hidden top-level heading for the document outline.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Activity' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('status-fitness-status')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Engagement' })
    ).toBeInTheDocument()
  })
})

describe('Page visibility for logged-in non-recipient viewers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // clearAllMocks does not reset implementations; getStatus is only set by
    // individual ancestor tests, so reset it to avoid leaking across tests.
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue({} as never)
    mockGetActorFromSession.mockResolvedValue(buildViewer())
    mockGetStatusReplies.mockResolvedValue([])
    // Default: the viewer does not follow anyone.
    mockGetAcceptedOrRequestedFollow.mockResolvedValue(null)
  })

  it.each([
    {
      description:
        'does not render a followers-only ancestor the viewer cannot read',
      parentId: 'private-parent',
      // followers-only by another author the viewer does not follow
      parentTo: [`${AUTHOR_ID}/followers`]
    },
    {
      description:
        'does not render a direct-message ancestor the viewer is not addressed in',
      parentId: 'dm-parent',
      // direct message to someone other than the viewer
      parentTo: ['https://activities.local/users/bob']
    }
  ])('$description', async ({ parentId, parentTo }) => {
    const focused = buildNote({ id: 'public-reply', reply: parentId })
    const unreadableParent = buildNote({
      id: parentId,
      reply: '',
      to: parentTo,
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(unreadableParent)

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(screen.queryByTestId(`status-${parentId}`)).not.toBeInTheDocument()
  })

  it('stops climbing the ancestor chain at the first unreadable parent', async () => {
    // public reply -> followers-only parent (unreadable) -> public grandparent.
    // The loop must break at the private parent, so neither it nor the readable
    // grandparent beyond it is rendered.
    const focused = buildNote({ id: 'public-reply', reply: 'private-parent' })
    const privateParent = buildNote({
      id: 'private-parent',
      reply: 'public-grandparent',
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })
    const publicGrandparent = buildNote({
      id: 'public-grandparent',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'public-reply',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockImplementation(async ({ statusId }) => {
      if (statusId === 'private-parent') return privateParent
      if (statusId === 'public-grandparent') return publicGrandparent
      return null
    })

    await renderPage()

    expect(screen.getByTestId('status-public-reply')).toBeInTheDocument()
    expect(
      screen.queryByTestId('status-private-parent')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('status-public-grandparent')
    ).not.toBeInTheDocument()
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

  it('renders a non-public reply the query returns and does not apply the public-only backstop', async () => {
    const focused = buildNote({ id: 'focused' })
    // A direct-message reply addressed to the viewer: not publicly readable,
    // but `getStatusReplies` returns it via the `visibleToActorId` filter. The
    // logged-out-only `isStatusPubliclyReadable` backstop must NOT strip it for
    // an authenticated viewer — dropping the `if (!currentActor)` guard would
    // hide this reply and fail here.
    const dmReplyToViewer = buildNote({
      id: 'dm-to-viewer',
      reply: 'focused',
      actorId: 'https://activities.local/users/bob',
      to: [VIEWER_ID],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatusReplies.mockResolvedValue([dmReplyToViewer])

    await renderPage()

    expect(screen.getByTestId('status-dm-to-viewer')).toBeInTheDocument()
    expect(screen.getByText('Replies (1)')).toBeInTheDocument()
  })

  // Focused-status visibility gate. These exercise the consolidated
  // `canActorReadStatus` gate on the focused status itself (not an ancestor),
  // which previously had a bespoke inline reimplementation.
  it('renders a focused followers-only status whose followersUrl does not end in /followers when the viewer follows the author', async () => {
    // Regression: a remote author whose stored followersUrl uses a
    // non-`/followers` path. The old inline gate detected followers-only
    // audience with `endsWith('/followers')`, so it misread this as a direct
    // message and returned notFound for a legitimate follower.
    // `hasFollowersAudience` exact-matches the actor's stored `followersUrl`.
    const customFollowersUrl = `${REMOTE_AUTHOR_ID}/followers-collection`
    const focused = buildNote({
      id: 'remote-followers-only',
      actorId: REMOTE_AUTHOR_ID,
      actor: {
        followersUrl: customFollowersUrl
      } as unknown as Status['actor'],
      isLocalActor: false,
      // Viewer is NOT addressed in to/cc — only the followers collection is, so
      // the old DM branch would have rejected this follower.
      to: [customFollowersUrl],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'remote-followers-only',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    await renderPage()

    expect(
      screen.getByTestId('status-remote-followers-only')
    ).toBeInTheDocument()
  })

  it('returns notFound for a focused followers-only status when the viewer does not follow the author', async () => {
    const focused = buildNote({
      id: 'focused-followers-only',
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused-followers-only',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    // Default follow mock returns null (the viewer is not a follower).

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders a focused direct message addressed to the viewer', async () => {
    const focused = buildNote({
      id: 'focused-dm-to-viewer',
      actorId: 'https://activities.local/users/bob',
      to: [VIEWER_ID],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused-dm-to-viewer',
      fullStatusId: focused.url,
      isStatusHash: true
    })

    await renderPage()

    expect(
      screen.getByTestId('status-focused-dm-to-viewer')
    ).toBeInTheDocument()
  })

  it('returns notFound for a focused direct message the viewer is not addressed in', async () => {
    const focused = buildNote({
      id: 'focused-dm-to-bob',
      to: ['https://activities.local/users/bob'],
      cc: []
    })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused-dm-to-bob',
      fullStatusId: focused.url,
      isStatusHash: true
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('returns notFound for a focused public boost of a followers-only original when the viewer does not follow the boosted author', async () => {
    const privateOriginal = buildNote({
      id: 'private-original',
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })
    const announce = buildAnnounce(privateOriginal)

    mockResolveStatusFromPath.mockResolvedValue({
      status: announce,
      statusId: 'public-announce',
      fullStatusId: privateOriginal.url,
      isStatusHash: true
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders a focused public boost of a followers-only original when the viewer follows the boosted author', async () => {
    const privateOriginal = buildNote({
      id: 'private-original',
      to: [`${AUTHOR_ID}/followers`],
      cc: []
    })
    const announce = buildAnnounce(privateOriginal)

    mockResolveStatusFromPath.mockResolvedValue({
      status: announce,
      statusId: 'public-announce',
      fullStatusId: privateOriginal.url,
      isStatusHash: true
    })
    mockGetAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    await renderPage()

    expect(screen.getByTestId('status-public-announce')).toBeInTheDocument()
  })

  // The Announce recursion landing on the direct-recipient branch of the
  // boosted original (rather than the followers-only branch above).
  it('renders a focused public boost whose original is a direct message addressed to the viewer', async () => {
    const dmOriginal = buildNote({
      id: 'dm-original',
      actorId: 'https://activities.local/users/anna',
      to: [VIEWER_ID],
      cc: []
    })
    const announce = buildAnnounce(dmOriginal)

    mockResolveStatusFromPath.mockResolvedValue({
      status: announce,
      statusId: 'public-announce',
      fullStatusId: dmOriginal.url,
      isStatusHash: true
    })

    await renderPage()

    expect(screen.getByTestId('status-public-announce')).toBeInTheDocument()
    // Granted by direct-recipient match on the original, not by a follow lookup.
    expect(mockGetAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })

  it('returns notFound for a focused public boost whose original is a direct message the viewer is not addressed in', async () => {
    const dmOriginal = buildNote({
      id: 'dm-original',
      actorId: 'https://activities.local/users/anna',
      to: ['https://activities.local/users/bob'],
      cc: []
    })
    const announce = buildAnnounce(dmOriginal)

    mockResolveStatusFromPath.mockResolvedValue({
      status: announce,
      statusId: 'public-announce',
      fullStatusId: dmOriginal.url,
      isStatusHash: true
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('Page visibility for the focused-status author', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue({} as never)
    // The signed-in viewer IS the author of the focused status.
    mockGetActorFromSession.mockResolvedValue({
      ...buildViewer(),
      id: AUTHOR_ID
    } as unknown as Actor)
    mockGetStatusReplies.mockResolvedValue([])
    // If the author branch regressed, a non-public status would fall through to
    // a follow lookup; this null mock would then deny access (notFound).
    mockGetAcceptedOrRequestedFollow.mockResolvedValue(null)
  })

  // The old inline gate had an explicit "authors can always see their own
  // non-public statuses" rule. `canActorReadStatus` preserves it via the
  // `currentActor.id === status.actorId` short-circuit; these lock it down so
  // authors never get a 404 on their own followers-only post or direct message.
  it.each([
    {
      description: 'renders the author own focused followers-only status',
      id: 'own-followers-only',
      to: [`${AUTHOR_ID}/followers`]
    },
    {
      description: 'renders the author own focused direct message',
      id: 'own-dm',
      to: ['https://activities.local/users/bob']
    }
  ])('$description', async ({ id, to }) => {
    const focused = buildNote({ id, to, cc: [] })

    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: id,
      fullStatusId: focused.url,
      isStatusHash: true
    })

    await renderPage()

    expect(screen.getByTestId(`status-${id}`)).toBeInTheDocument()
    // Access is granted by identity, not by a follow lookup.
    expect(mockGetAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })
})

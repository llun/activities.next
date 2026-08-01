/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'
import { resolveStatusFromPath } from './resolveStatusFromPath'

vi.mock('next/navigation', async () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
}))

vi.mock('@/lib/config', async () => ({
  getConfig: vi.fn(() => ({
    host: 'activities.local',
    fitnessStorage: undefined,
    mediaStorage: undefined
  }))
}))

const mockGetStatus = vi.fn()
const mockGetStatusReplies = vi.fn()
const mockGetAcceptedOrRequestedFollow = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: vi.fn(() => ({
    getStatus: mockGetStatus,
    getStatusReplies: mockGetStatusReplies,
    getAcceptedOrRequestedFollow: mockGetAcceptedOrRequestedFollow
  }))
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

vi.mock('./resolveStatusFromPath', async () => ({
  ...(await vi.importActual('./resolveStatusFromPath')),
  resolveStatusFromPath: vi.fn()
}))

vi.mock('./RemoteStatusLoading', async () => ({
  RemoteStatusLoading: () => null
}))

// The header is what the clip moved onto, so it stays real enough to find —
// only its `useRouter` dependency is stubbed above.
vi.mock('./StatusBox', async () => ({
  StatusBox: () => <div data-testid="status-box" />
}))

const mockResolveStatusFromPath = vi.mocked(resolveStatusFromPath)
const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const AUTHOR_ID = 'https://activities.local/users/athlete'
const VIEWER_ID = 'https://activities.local/users/viewer'

// `isFitnessDashboard` keys off a completed fitness file, and that branch is
// the one that renders `FitnessStatusDetail` — and its action row's overlays.
const buildFitnessNote = (): Status =>
  ({
    id: 'ride-1',
    type: 'Note',
    actorId: AUTHOR_ID,
    actor: null,
    url: `${AUTHOR_ID}/statuses/ride-1`,
    text: 'Sunset loop',
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
    fitness: {
      id: 'fit-1',
      fileName: 'ride.fit',
      fileType: 'fit',
      processingStatus: 'completed',
      activityType: 'ride',
      hasMapData: false
    }
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
      actor: '@athlete@activities.local',
      status: 'hash'
    })
  })
  const { container } = render(element)
  return container.firstElementChild as HTMLElement
}

// The card the fitness branch wraps everything in. It is NOT the conversation
// card below it in `page.tsx` — that one has its own copy of this treatment —
// and it is the last clipping ancestor between a fitness post's action row and
// the viewport. `FitnessStatusDetail` dropping its own clip only freed the
// overlays from the inner box; a tooltip anchored under the leftmost actions
// starts left of this card too, so this one has to let them out as well.
describe('Fitness activity card chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])

    const status = buildFitnessNote()
    mockResolveStatusFromPath.mockResolvedValue({
      status,
      statusId: 'ride-1',
      fullStatusId: status.url,
      isStatusHash: true
    })
  })

  it('does not clip its children, so post overlays can escape it', async () => {
    const card = await renderPage()

    expect(card).toHaveClass('rounded-2xl')
    expect(card).not.toHaveClass('overflow-hidden')
  })

  // Unlike the conversation card, every child here paints a background, so with
  // the clip gone each corner a child reaches has to be rounded by that child.
  it('rounds the header wrapper and the post block for a signed-in viewer', async () => {
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const card = await renderPage()
    const [header, post] = Array.from(card.children)

    // The wrapper, not the header itself: `Header` is `sticky top-0`, so it
    // needs to keep a clipping ancestor or it starts detaching mid-scroll and
    // carries the corners out over the post.
    expect(header).toHaveClass('rounded-t-2xl')
    expect(header).toHaveClass('overflow-hidden')
    // The header takes the top corners, so the post block below it takes only
    // the bottom ones — it is the last child when nobody is signed out.
    expect(post).not.toHaveClass('rounded-t-2xl')
    expect(post).toHaveClass('rounded-b-2xl')
  })

  it('gives the post block the top corners when logged out, which has no header', async () => {
    const card = await renderPage()
    const [heading, post] = Array.from(card.children)

    // The logged-out branch leads with an `sr-only` heading, which is out of
    // flow and paints nothing — the post block below it meets the corners.
    expect(heading).toHaveClass('sr-only')
    expect(post).toHaveClass('rounded-t-2xl')
    // …but not the bottom ones: the sign-in callout renders below it.
    expect(post).not.toHaveClass('rounded-b-2xl')
  })

  it('gives the bottom corners to the sign-in callout when logged out', async () => {
    const card = await renderPage()

    // Anchored on the callout's own text rather than a child index, so this
    // keeps meaning the right element if the card gains another block.
    const callout = screen
      .getByText('Join the conversation')
      .closest('div.bg-primary\\/5')
    expect(callout).toHaveClass('rounded-b-2xl')
    expect(card.lastElementChild).toBe(callout)
  })
})

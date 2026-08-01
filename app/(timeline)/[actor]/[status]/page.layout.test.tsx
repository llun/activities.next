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
    getAcceptedOrRequestedFollow: mockGetAcceptedOrRequestedFollow,
    // Without this the page's settings read throws and every test logs an
    // error while quietly exercising the env/default fallback path.
    getAllServerSettings: vi.fn(async () => [])
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

vi.mock('./StatusBox', async () => ({
  StatusBox: ({ status }: { status: { id: string } }) => (
    <div data-testid={`status-${status.id}`} />
  )
}))

const mockResolveStatusFromPath = vi.mocked(resolveStatusFromPath)
const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const AUTHOR_ID = 'https://activities.local/users/anna'
const VIEWER_ID = 'https://activities.local/users/viewer'

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
  const { container } = render(element)
  return container.firstElementChild as HTMLElement
}

describe('Conversation card chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])

    const focused = buildNote({ id: 'focused' })
    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
  })

  // The card wraps posts, and the edit-history panel — which is not portalled
  // — opens upward out of it. `Posts` dropped `overflow-hidden` for the same
  // reason. Clipping here was what a comment on this card wrongly claimed was
  // already gone, so pin it off rather than trusting the comment.
  it('does not clip its children, so post overlays can escape it', async () => {
    const card = await renderPage()

    expect(card).toHaveClass('rounded-2xl')
    // Reject every clip, not just `overflow-hidden`: `overflow-x-hidden` would
    // force the computed `overflow-y` to `auto`, re-clipping the panel
    // vertically while an assertion naming only `overflow-hidden` passed.
    // `overflow-x-clip` is the one form that does not clip the other axis, but
    // it is also not needed here, so the simplest guard is to allow none.
    const clipping = Array.from(card.classList).filter((name) =>
      name.startsWith('overflow-')
    )
    expect(clipping).toEqual([])
  })

  // Nothing clips for the rounded corners any more, so the child that meets
  // them has to round itself or its square background bleeds past the border.
  // Exactly one child may do so — a second would notch a rounded row into the
  // middle of the card.
  // `StatusBox` is mocked to a bare testid div, so the row that carries the
  // radius is its parent. Anchoring on the status rather than a child index
  // keeps the assertion meaningful if the card gains another child.
  const rowFor = (statusId: string) =>
    screen.getByTestId(`status-${statusId}`).parentElement

  it('rounds the header wrapper, its topmost child, for a signed-in viewer', async () => {
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const card = await renderPage()

    // The wrapper, not the header itself: `Header` is `sticky top-0`, so it
    // has to keep a clipping ancestor or it starts detaching mid-scroll and
    // carries the corners out over the posts.
    expect(card.firstElementChild).toHaveClass('rounded-t-2xl')
    expect(card.firstElementChild).toHaveClass('overflow-hidden')
    // The header takes the corners, so the post below it must not — even
    // though it is the topmost *post* and would take them when logged out.
    expect(rowFor('focused')).not.toHaveClass('rounded-t-2xl')
  })

  it('rounds the focused post instead when logged out, which has no header', async () => {
    const card = await renderPage()

    // The logged-out branch leads with an `sr-only` heading, which is out of
    // flow and paints nothing — the post below it is what meets the corners.
    expect(card.firstElementChild).toHaveClass('sr-only')
    expect(rowFor('focused')).toHaveClass('rounded-t-2xl')
  })

  it('rounds the first ancestor row when logged out and the post is a reply', async () => {
    const focused = buildNote({ id: 'focused', reply: 'parent' })
    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(buildNote({ id: 'parent' }))

    await renderPage()

    // The ancestor chain now sits above the focused post, so it takes the
    // corners and the post must not keep them.
    expect(rowFor('parent')).toHaveClass('rounded-t-2xl')
    expect(rowFor('focused')).not.toHaveClass('rounded-t-2xl')
  })

  // With a single ancestor, `index === 0` and `index === previouses.length - 1`
  // are the same row, so a chain of two is what distinguishes the topmost
  // ancestor from the one nearest the focused post. The chain runs up to three.
  it('rounds only the topmost ancestor when the chain is longer than one', async () => {
    const focused = buildNote({ id: 'focused', reply: 'parent' })
    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockImplementation(
      async ({ statusId }: { statusId: string }) =>
        statusId === 'parent'
          ? buildNote({ id: 'parent', reply: 'grandparent' })
          : buildNote({ id: 'grandparent' })
    )

    await renderPage()

    expect(rowFor('grandparent')).toHaveClass('rounded-t-2xl')
    expect(rowFor('parent')).not.toHaveClass('rounded-t-2xl')
    expect(rowFor('focused')).not.toHaveClass('rounded-t-2xl')
  })

  // Both rounding rules are guarded on the viewer being logged out, because a
  // signed-in viewer gets the header above everything. Without this, deleting
  // either guard leaves the suite green while shipping a rounded row notched
  // into the middle of the card.
  it('rounds neither the ancestor row nor the post for a signed-in viewer', async () => {
    mockGetActorFromSession.mockResolvedValue(buildViewer())
    const focused = buildNote({ id: 'focused', reply: 'parent' })
    mockResolveStatusFromPath.mockResolvedValue({
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockResolvedValue(buildNote({ id: 'parent' }))

    const card = await renderPage()

    expect(card.firstElementChild).toHaveClass('rounded-t-2xl')
    expect(rowFor('parent')).not.toHaveClass('rounded-t-2xl')
    expect(rowFor('focused')).not.toHaveClass('rounded-t-2xl')
  })
})

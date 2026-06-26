/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  type FitnessRouteDataResponse,
  getFitnessFilesByStatus,
  getFitnessRouteData
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote } from '@/lib/types/domain/status'

import { FitnessStatusDetail } from './FitnessStatusDetail'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessRouteData: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}))

vi.mock('@/lib/components/posts/actor', () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: () => <div data-testid="media" />
}))

vi.mock('@/lib/components/posts/post', () => ({
  Post: ({ status }: { status: { id: string } }) => (
    <div data-testid="reply-post">{status.id}</div>
  )
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
}))

vi.mock('@/lib/components/posts/actions/reply-button', () => ({
  ReplyButton: ({ onReply }: { onReply?: () => void }) => (
    <button type="button" onClick={() => onReply?.()}>
      Reply
    </button>
  )
}))

vi.mock('@/lib/components/posts/actions/repost-button', () => ({
  RepostButton: () => <button type="button">Boost</button>
}))

vi.mock('@/lib/components/posts/actions/like-button', () => ({
  LikeButton: () => <button type="button">Like</button>
}))

vi.mock('@/lib/components/posts/actions/bookmark-button', () => ({
  BookmarkButton: () => <button type="button">Bookmark</button>
}))

vi.mock('@/lib/components/posts/actions/post-menu', () => ({
  PostMenu: () => <button type="button">More</button>
}))

vi.mock('@/lib/components/posts/BrandedDeviceLink', () => ({
  BrandedDeviceLink: () => <span>device</span>
}))

const mockGetFitnessFilesByStatus = vi.mocked(getFitnessFilesByStatus)
const mockGetFitnessRouteData = vi.mocked(getFitnessRouteData)

const actor = {
  id: 'https://activities.local/users/athlete',
  username: 'athlete',
  domain: 'activities.local',
  name: 'Athlete Runner'
} as unknown as ActorProfile

const buildStatus = (overrides: Partial<StatusNote> = {}): StatusNote =>
  ({
    id: 'https://activities.local/users/athlete/statuses/ride-1',
    actorId: actor.id,
    actor,
    type: 'Note',
    url: 'https://activities.local/@athlete/ride-1',
    text: 'Sunset loop',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    edits: [],
    isLocalActor: true,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 4,
    totalShares: 2,
    attachments: [],
    tags: [],
    createdAt: Date.parse('2026-05-27T10:42:00Z'),
    updatedAt: Date.parse('2026-05-27T10:42:00Z'),
    fitness: {
      id: 'fit-1',
      fileName: 'ride.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 2048,
      url: 'https://activities.local/fit/ride.fit',
      processingStatus: 'completed',
      totalDistanceMeters: 5000,
      totalDurationSeconds: 1800,
      elevationGainMeters: 120,
      activityType: 'ride',
      hasMapData: false
    },
    ...overrides
  }) as unknown as StatusNote

const routeData: FitnessRouteDataResponse = {
  samples: [
    { lat: 13.7, lng: 100.5, elapsedSeconds: 0 },
    { lat: 13.71, lng: 100.51, elapsedSeconds: 900 },
    { lat: 13.72, lng: 100.52, elapsedSeconds: 1800 }
  ],
  totalDurationSeconds: 1800,
  powerSeries: [120, 150, 180, 210, 90, 60],
  heartRateSeries: [110, 130, 150, 165, 175, 140],
  altitudeSeries: [10, 24, 40, 55, 48, 30],
  speedSeries: [18, 22, 25, 28, 20, 16]
}

const renderDetail = (
  props: Partial<Parameters<typeof FitnessStatusDetail>[0]> = {}
) =>
  render(
    <FitnessStatusDetail
      host="activities.local"
      currentTime={Date.parse('2026-05-27T12:00:00Z')}
      currentActor={actor}
      status={buildStatus()}
      onShowAttachment={vi.fn()}
      {...props}
    />
  )

const openSectionMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: /Overview/ }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    mockGetFitnessFilesByStatus.mockReset()
    mockGetFitnessRouteData.mockReset()
    mockGetFitnessFilesByStatus.mockResolvedValue(null)
    mockGetFitnessRouteData.mockResolvedValue(routeData)
  })

  it('renders the activity header with the type badge, title and primary stats', async () => {
    renderDetail()

    expect(screen.getByText('Athlete Runner')).toBeInTheDocument()
    expect(screen.getByText('@athlete@activities.local')).toBeInTheDocument()
    // Type badge derived from the activity type.
    expect(screen.getByText('Ride')).toBeInTheDocument()
    // Status caption becomes the activity title.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sunset loop' })
    ).toBeInTheDocument()
    // Primary stat strip.
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('5.00')).toBeInTheDocument()
    expect(screen.getByText('Moving time')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()

    // The secondary Overview stats derive from the loaded route series.
    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())
  })

  it('switches to the heart rate zones section from the sub-navigation', async () => {
    renderDetail()

    // Wait for the route data so the heart-rate zones tab is offered.
    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Heart rate zones' })
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Heart rate zones' })
      ).toBeInTheDocument()
    )
    expect(screen.getByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText('Anaerobic')).toBeInTheDocument()
  })

  it('opens the comments section with the composer and replies when the reply action is used', async () => {
    const reply = {
      id: 'reply-1',
      type: 'Note',
      actorId: actor.id,
      actor
    } as unknown as Status

    renderDetail({ replies: [reply] })

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(screen.getByTestId('comment-composer')).toBeInTheDocument()
    expect(screen.getByTestId('reply-post')).toHaveTextContent('reply-1')
  })

  it('omits the comments tab for logged-out viewers with no replies', async () => {
    renderDetail({ currentActor: null, replies: [] })

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Comments' })
    ).not.toBeInTheDocument()
    // The action bar is also hidden for logged-out viewers.
    expect(
      screen.queryByRole('button', { name: 'Reply' })
    ).not.toBeInTheDocument()
  })
})

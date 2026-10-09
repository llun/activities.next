/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { type StatusNote, StatusType } from '@/lib/types/domain/status'
import type { Tag } from '@/lib/types/mastodon/tag'

import { ExplorePageClient } from './ExplorePageClient'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn()
}))

// Keep the real client so the interactive post buttons resolve their (never
// called at render) imports; only stub the three trends loaders.
vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getTrendingTags: vi.fn(),
  getTrendingStatuses: vi.fn(),
  getTrendingLinks: vi.fn()
}))

const mockGetTrendingTags = getTrendingTags as jest.Mock
const mockGetTrendingStatuses = getTrendingStatuses as jest.Mock
const mockGetTrendingLinks = getTrendingLinks as jest.Mock
const mockUseRouter = useRouter as jest.Mock
const mockUseSearchParams = useSearchParams as jest.Mock

const HOST = 'llun.test'

const viewer: ActorProfile = {
  id: 'https://llun.test/users/viewer',
  username: 'viewer',
  domain: 'llun.test',
  name: 'Viewer',
  followersUrl: 'https://llun.test/users/viewer/followers',
  inboxUrl: 'https://llun.test/users/viewer/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0
}

const author: StatusNote['actor'] = {
  ...viewer,
  id: 'https://llun.test/users/alice',
  username: 'alice',
  name: 'Alice',
  followersUrl: 'https://llun.test/users/alice/followers',
  inboxUrl: 'https://llun.test/users/alice/inbox'
}

const tag = (name: string): Tag => ({
  name,
  url: `https://llun.test/tags/${name}`,
  history: [
    { day: '1700000000', uses: '60', accounts: '40' },
    { day: '1699913600', uses: '40', accounts: '20' }
  ]
})

const status = (overrides: Partial<StatusNote> = {}): StatusNote => ({
  id: 'https://llun.test/users/alice/statuses/p1',
  actorId: author.id,
  actor: author,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: new Date('2026-06-14T11:55:00.000Z').getTime(),
  updatedAt: new Date('2026-06-14T11:55:00.000Z').getTime(),
  type: StatusType.enum.Note,
  url: 'https://llun.test/@alice/p1',
  text: '<p>Gravel season is here</p>',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 7,
  totalShares: 5,
  attachments: [],
  tags: [],
  ...overrides
})

const mockReplace = vi.fn()

const renderExplore = (tabParam: string | null, currentTime: number) => {
  const params = new URLSearchParams(tabParam ? { tab: tabParam } : {})
  mockUseSearchParams.mockReturnValue(params)
  mockUseRouter.mockReturnValue({ replace: mockReplace, push: vi.fn() })
  return render(
    <ExplorePageClient
      host={HOST}
      currentActor={viewer}
      currentTime={currentTime}
      isMediaUploadEnabled={false}
    />
  )
}

describe('ExplorePageClient', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockGetTrendingTags.mockReset().mockResolvedValue([])
    mockGetTrendingStatuses.mockReset().mockResolvedValue([])
    mockGetTrendingLinks.mockReset().mockResolvedValue([])
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(function () {
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          unobserve: vi.fn()
        }
      })
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('loads and renders trending hashtags on the default tab', async () => {
    mockGetTrendingTags.mockResolvedValue([tag('fediverse'), tag('gravel')])

    renderExplore(null, Date.now())

    expect(await screen.findByText('#fediverse')).toBeInTheDocument()
    expect(screen.getByText('#gravel')).toBeInTheDocument()
    expect(mockGetTrendingTags).toHaveBeenCalledWith(20)
    expect(mockGetTrendingStatuses).not.toHaveBeenCalled()
  })

  it.each([
    ['hashtags', null, mockGetTrendingTags, 'Loading trends'],
    ['posts', 'posts', mockGetTrendingStatuses, 'Loading posts']
  ])(
    'announces the %s loading state to assistive tech without painting text',
    (_tab, tabParam, loader, announcement) => {
      loader.mockReturnValue(new Promise(() => {}))
      renderExplore(tabParam, Date.now())

      const status = screen.getByRole('status')
      expect(status).toHaveTextContent(announcement)
      expect(status.querySelector('.sr-only')).toHaveTextContent(announcement)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    }
  )

  it('shows the empty state when no hashtags are trending', async () => {
    renderExplore(null, Date.now())

    expect(
      await screen.findByText('Nothing is trending right now')
    ).toBeInTheDocument()
  })

  it('shows the empty state when no posts are trending', async () => {
    renderExplore('posts', Date.now())

    expect(
      await screen.findByText('No posts are trending right now')
    ).toBeInTheDocument()
  })

  it('renders trending posts with the interactive timeline controls', async () => {
    mockGetTrendingStatuses.mockResolvedValue([status()])

    // currentTime is five minutes after the post's created_at.
    const currentTime = new Date('2026-06-14T12:00:00.000Z').getTime()
    renderExplore('posts', currentTime)

    expect(await screen.findByText('Gravel season is here')).toBeInTheDocument()
    // Relative time is derived from the server-provided currentTime, not
    // Date.now(), so SSR and hydration agree.
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(mockGetTrendingStatuses).toHaveBeenCalledWith(20)

    // The trending posts now carry the same action row as the timeline.
    expect(
      screen.getByRole('button', { name: /Reply to post/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Like/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repost' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toBeInTheDocument()
  })

  it('shows an error alert when loading trends fails', async () => {
    mockGetTrendingTags.mockRejectedValue(new Error('boom'))

    renderExplore(null, Date.now())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load trends right now"
    )
  })

  it('retries the active tab when the Retry button is clicked', async () => {
    mockGetTrendingTags
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([tag('fediverse')])

    renderExplore(null, Date.now())

    const retry = await screen.findByRole('button', { name: 'Retry' })
    fireEvent.click(retry)

    expect(await screen.findByText('#fediverse')).toBeInTheDocument()
    expect(mockGetTrendingTags).toHaveBeenCalledTimes(2)
  })

  it('shows the news empty note when no links are trending', async () => {
    renderExplore('news', Date.now())

    expect(
      await screen.findByText('No trending links right now')
    ).toBeInTheDocument()
    expect(mockGetTrendingLinks).toHaveBeenCalledWith(20)
  })

  it('offers the three sections as tabs with the current one chosen', async () => {
    renderExplore('posts', Date.now())

    const group = screen.getByRole('radiogroup', { name: 'Explore sections' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: 'Posts' })).toBeChecked()
    expect(
      within(group).getByRole('radio', { name: 'Hashtags' })
    ).not.toBeChecked()
    await screen.findByText('No posts are trending right now')
  })

  it('switches tab through the URL, keeping the scroll position', async () => {
    renderExplore(null, Date.now())
    await screen.findByText('Nothing is trending right now')

    fireEvent.click(screen.getByRole('radio', { name: 'Posts' }))
    expect(mockReplace).toHaveBeenLastCalledWith('/explore?tab=posts', {
      scroll: false
    })

    fireEvent.click(screen.getByRole('radio', { name: 'News' }))
    expect(mockReplace).toHaveBeenLastCalledWith('/explore?tab=news', {
      scroll: false
    })
  })

  it('drops the tab parameter when going back to hashtags', async () => {
    renderExplore('posts', Date.now())
    await screen.findByText('No posts are trending right now')

    fireEvent.click(screen.getByRole('radio', { name: 'Hashtags' }))

    expect(mockReplace).toHaveBeenLastCalledWith('/explore', { scroll: false })
  })
})

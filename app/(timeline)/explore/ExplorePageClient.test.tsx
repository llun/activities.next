/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags
} from '@/lib/client'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import type { Tag } from '@/lib/types/mastodon/tag'

import { ExplorePageClient } from './ExplorePageClient'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn()
}))

jest.mock('@/lib/client', () => ({
  getTrendingTags: jest.fn(),
  getTrendingStatuses: jest.fn(),
  getTrendingLinks: jest.fn()
}))

const mockGetTrendingTags = getTrendingTags as jest.Mock
const mockGetTrendingStatuses = getTrendingStatuses as jest.Mock
const mockGetTrendingLinks = getTrendingLinks as jest.Mock
const mockUseRouter = useRouter as jest.Mock
const mockUseSearchParams = useSearchParams as jest.Mock

const tag = (name: string): Tag => ({
  name,
  url: `https://llun.test/tags/${name}`,
  history: [
    { day: '1700000000', uses: '60', accounts: '40' },
    { day: '1699913600', uses: '40', accounts: '20' }
  ]
})

const status = (overrides: Partial<MastodonStatus> = {}): MastodonStatus =>
  ({
    id: 'p1',
    uri: 'https://llun.test/users/alice/statuses/p1',
    url: 'https://llun.test/@alice/p1',
    account: {
      id: 'alice',
      username: 'alice',
      acct: 'alice',
      display_name: 'Alice',
      avatar: '',
      note: ''
    },
    content: '<p>Gravel season is here</p>',
    created_at: new Date('2026-06-14T11:55:00.000Z').toISOString(),
    replies_count: 3,
    reblogs_count: 5,
    favourites_count: 7,
    ...overrides
  }) as MastodonStatus

const renderExplore = (tabParam: string | null, currentTime: number) => {
  const params = new URLSearchParams(tabParam ? { tab: tabParam } : {})
  mockUseSearchParams.mockReturnValue(params)
  mockUseRouter.mockReturnValue({ replace: jest.fn(), push: jest.fn() })
  return render(<ExplorePageClient currentTime={currentTime} />)
}

describe('ExplorePageClient', () => {
  beforeEach(() => {
    mockGetTrendingTags.mockReset().mockResolvedValue([])
    mockGetTrendingStatuses.mockReset().mockResolvedValue([])
    mockGetTrendingLinks.mockReset().mockResolvedValue([])
  })

  it('loads and renders trending hashtags on the default tab', async () => {
    mockGetTrendingTags.mockResolvedValue([tag('fediverse'), tag('gravel')])

    renderExplore(null, Date.now())

    expect(await screen.findByText('#fediverse')).toBeInTheDocument()
    expect(screen.getByText('#gravel')).toBeInTheDocument()
    expect(mockGetTrendingTags).toHaveBeenCalledWith(20)
    expect(mockGetTrendingStatuses).not.toHaveBeenCalled()
  })

  it('shows the empty note when no hashtags are trending', async () => {
    renderExplore(null, Date.now())

    expect(
      await screen.findByText(/Nothing is trending right now/)
    ).toBeInTheDocument()
  })

  it('renders trending posts with a relative time derived from currentTime', async () => {
    mockGetTrendingStatuses.mockResolvedValue([status()])

    // currentTime is five minutes after the post's created_at.
    const currentTime = new Date('2026-06-14T12:00:00.000Z').getTime()
    renderExplore('posts', currentTime)

    expect(await screen.findByText('Gravel season is here')).toBeInTheDocument()
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument()
    expect(mockGetTrendingStatuses).toHaveBeenCalledWith(20)
  })

  it('shows the news empty note when no links are trending', async () => {
    renderExplore('news', Date.now())

    expect(
      await screen.findByText(/No trending links right now/)
    ).toBeInTheDocument()
    expect(mockGetTrendingLinks).toHaveBeenCalledWith(20)
  })
})

/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { getTrendingTags } from '@/lib/client'
import { TrendingNowBlock } from '@/lib/components/trends/trending-now-block'
import type { Tag } from '@/lib/types/mastodon/tag'

jest.mock('@/lib/client', () => ({
  getTrendingTags: jest.fn()
}))

const mockGetTrendingTags = getTrendingTags as jest.Mock

const tag = (name: string, accounts: string): Tag => ({
  name,
  url: `https://llun.test/tags/${name}`,
  history: [
    { day: '1700000000', uses: '40', accounts },
    { day: '1699913600', uses: '30', accounts: '0' }
  ]
})

describe('TrendingNowBlock', () => {
  beforeEach(() => {
    mockGetTrendingTags.mockReset()
  })

  it('renders the top trending hashtags with a See more link', async () => {
    mockGetTrendingTags.mockResolvedValue([
      tag('fediverse', '120'),
      tag('gravel', '80')
    ])

    render(<TrendingNowBlock />)

    expect(await screen.findByText('Trending now')).toBeInTheDocument()
    expect(screen.getByText('#fediverse')).toBeInTheDocument()
    expect(screen.getByText('#gravel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See more' })).toHaveAttribute(
      'href',
      '/explore'
    )
    expect(mockGetTrendingTags).toHaveBeenCalledWith(4)
  })

  it('renders nothing when there are no trends', async () => {
    mockGetTrendingTags.mockResolvedValue([])

    const { container } = render(<TrendingNowBlock />)

    await waitFor(() => expect(mockGetTrendingTags).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Trending now')).not.toBeInTheDocument()
  })
})

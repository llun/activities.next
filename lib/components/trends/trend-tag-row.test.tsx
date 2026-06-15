/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { TrendTagRow } from '@/lib/components/trends/trend-tag-row'
import type { Tag } from '@/lib/types/mastodon/tag'

const tag: Tag = {
  name: 'gravel',
  url: 'https://llun.test/tags/gravel',
  history: [
    { day: '1700000000', uses: '66', accounts: '40' },
    { day: '1699913600', uses: '58', accounts: '30' },
    { day: '1699827200', uses: '44', accounts: '20' }
  ]
}

describe('TrendTagRow', () => {
  it('renders the hashtag, people line, and links to the tag timeline', () => {
    render(<TrendTagRow tag={tag} />)

    expect(screen.getByText('#gravel')).toBeInTheDocument()
    expect(screen.getByText('70 people in the past 2 days')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tags/gravel')
  })

  it('uses the singular noun for a single person', () => {
    render(
      <TrendTagRow
        tag={{
          ...tag,
          history: [{ day: '1700000000', uses: '3', accounts: '1' }]
        }}
      />
    )

    expect(screen.getByText('1 person in the past 2 days')).toBeInTheDocument()
  })
})

/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'

import { FeaturedTagsBlock } from './FeaturedTagsBlock'

const buildTag = (overrides: Partial<FeaturedTag>): FeaturedTag => ({
  id: overrides.id ?? 't1',
  name: overrides.name ?? 'running',
  url: overrides.url ?? 'https://example.test/@anna/tagged/running',
  statuses_count: overrides.statuses_count ?? '128',
  last_status_at: overrides.last_status_at ?? null
})

describe('FeaturedTagsBlock', () => {
  it('renders nothing when there are no featured tags', () => {
    const { container } = render(<FeaturedTagsBlock tags={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chip per tag linking to its tagged timeline', () => {
    render(
      <FeaturedTagsBlock
        tags={[
          buildTag({
            id: 't1',
            name: 'running',
            statuses_count: '128',
            url: 'https://example.test/@anna/tagged/running'
          }),
          buildTag({
            id: 't2',
            name: 'cycling',
            statuses_count: '74',
            url: 'https://example.test/@anna/tagged/cycling'
          })
        ]}
      />
    )

    expect(screen.getByText('Featured hashtags')).toBeInTheDocument()

    // Chips link to the in-app hashtag timeline (/tags/<name>), not the
    // account-scoped Mastodon entity URL (which this app does not serve).
    const runningChip = screen.getByRole('link', { name: /#running/ })
    expect(runningChip).toHaveAttribute('href', '/tags/running')
    expect(runningChip).toHaveTextContent('128')

    const cyclingChip = screen.getByRole('link', { name: /#cycling/ })
    expect(cyclingChip).toHaveTextContent('74')
  })

  it('renders a non-renderable tag name as a non-link chip', () => {
    // A name the /tags/<name> route can't render (all-numeric here) would 404,
    // so it shows as a plain chip instead of a broken link.
    render(
      <FeaturedTagsBlock
        tags={[buildTag({ id: 't1', name: '2024', statuses_count: '9' })]}
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('#2024')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
  })
})

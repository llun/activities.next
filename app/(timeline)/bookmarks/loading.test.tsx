/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('bookmarks loading', () => {
  it('is busy and announces one polite "Loading bookmarks"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading bookmarks')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('outlines the header and a framed list of posts', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="post-list-skeleton"]')
    ).toBeInTheDocument()
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading bookmarks$/)
  })
})

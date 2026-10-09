/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('favorites loading', () => {
  it('is busy and announces one polite "Loading favorites"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading favorites')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('outlines the header and a framed list of posts, without a composer', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Post composer')).toBeNull()
    const posts = container.querySelector('[data-slot="post-list-skeleton"]')
    expect(posts).toBeInTheDocument()
    expect(posts?.children).toHaveLength(3)
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading favorites$/)
  })
})

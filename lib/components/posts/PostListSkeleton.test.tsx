/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { PostFeedLoading } from './PostFeedLoading'

describe('PostFeedLoading', () => {
  it('is a busy region announcing its label once, holding a header and the post list', () => {
    const { container } = render(<PostFeedLoading label="Loading bookmarks" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading bookmarks')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="post-list-skeleton"]')
    ).toBeInTheDocument()
    expect(container).toHaveTextContent(/^Loading bookmarks$/)
  })
})

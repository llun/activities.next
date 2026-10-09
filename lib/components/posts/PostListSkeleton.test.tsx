/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { PostFeedLoading } from './PostFeedLoading'
import { PostListSkeleton } from './PostListSkeleton'

describe('PostListSkeleton', () => {
  it('draws three placeholder posts by default and no text', () => {
    const { container } = render(<PostListSkeleton />)

    const list = container.querySelector('[data-slot="post-list-skeleton"]')
    expect(list?.children).toHaveLength(3)
    expect(container.textContent).toBe('')
  })

  it('draws as many placeholder posts as asked for', () => {
    const { container } = render(<PostListSkeleton rows={5} />)

    expect(
      container.querySelector('[data-slot="post-list-skeleton"]')?.children
    ).toHaveLength(5)
  })
})

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

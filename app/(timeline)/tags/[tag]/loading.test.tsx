/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('tags/[tag] loading', () => {
  it('is busy and announces one polite "Loading hashtag"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading hashtag')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('outlines the heading and a framed list of posts with no loading text', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="post-list-skeleton"]')
    ).toBeInTheDocument()
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading hashtag$/)
  })
})

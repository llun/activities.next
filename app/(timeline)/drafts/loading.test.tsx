/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('drafts loading', () => {
  it('announces one polite "Loading drafts" and draws the header and a framed list', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading drafts')
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="section-skeleton"]')
    ).toBeInTheDocument()
    expect(container.querySelector('[data-slot="frame"]')).toBeInTheDocument()
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading drafts$/)
  })
})

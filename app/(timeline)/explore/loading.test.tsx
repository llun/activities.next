/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('explore loading', () => {
  it('is busy and announces one polite "Loading explore"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading explore')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('outlines the header, tabs and a list of rows with no loading text', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).toBeInTheDocument()
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading explore$/)
  })
})

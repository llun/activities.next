/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('notifications loading', () => {
  it('announces one polite Loading and draws no text on screen', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    // The only text in the tree is the screen-reader label.
    expect(container.textContent).toBe('Loading notifications')
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('[actor]/following loading', () => {
  it('is busy and announces one polite "Loading following"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading following')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })
})

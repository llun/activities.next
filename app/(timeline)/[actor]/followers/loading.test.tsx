/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('[actor]/followers loading', () => {
  it('is busy and announces one polite "Loading followers"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading followers')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })
})

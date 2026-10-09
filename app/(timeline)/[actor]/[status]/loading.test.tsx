/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('[status] loading', () => {
  it('is busy and announces one polite "Loading post"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading post')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('draws placeholders only, with no text besides the status', () => {
    const { container } = render(<Loading />)

    expect(container).toHaveTextContent(/^Loading post$/)
  })
})

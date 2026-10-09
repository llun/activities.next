/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('album loading', () => {
  it('announces itself as busy, without the profile banner or avatar', () => {
    const { container } = render(<Loading />)

    expect(screen.getByText('Loading album')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByLabelText('Loading profile')).not.toBeInTheDocument()
  })

  it('draws every placeholder with the shimmer utility', () => {
    const { container } = render(<Loading />)

    const placeholders = container.querySelectorAll('[aria-hidden="true"]')
    expect(placeholders.length).toBeGreaterThan(0)
    for (const leaf of container.querySelectorAll('div:not(:has(div))')) {
      expect(leaf).toHaveClass('skeleton')
    }
  })
})

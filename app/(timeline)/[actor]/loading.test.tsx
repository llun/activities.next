/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Loading, { ProfileLoading } from './loading'

describe('[actor] loading', () => {
  it('renders loading profile skeleton with accessibility attributes and shimmer', () => {
    const { container } = render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading profile')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(10)
  })

  it('exports ProfileLoading named component', () => {
    render(<ProfileLoading />)

    expect(screen.getByLabelText('Loading profile')).toBeInTheDocument()
  })
})

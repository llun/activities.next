/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { ProfileLoading } from './loading'

describe('[actor] loading', () => {
  it('renders loading profile skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading profile')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports ProfileLoading named component', () => {
    render(<ProfileLoading />)

    expect(screen.getByLabelText('Loading profile')).toBeInTheDocument()
  })
})

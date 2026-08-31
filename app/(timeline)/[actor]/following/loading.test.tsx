/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { FollowingLoading } from './loading'

describe('[actor]/following loading', () => {
  it('renders loading following skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading following')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports FollowingLoading named component', () => {
    render(<FollowingLoading />)

    expect(screen.getByLabelText('Loading following')).toBeInTheDocument()
  })
})

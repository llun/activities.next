/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { FollowersLoading } from './loading'

describe('[actor]/followers loading', () => {
  it('renders loading followers skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading followers')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports FollowersLoading named component', () => {
    render(<FollowersLoading />)

    expect(screen.getByLabelText('Loading followers')).toBeInTheDocument()
  })
})

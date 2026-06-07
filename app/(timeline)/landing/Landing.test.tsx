/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Status } from '@/lib/types/domain/status'

import { Landing } from './Landing'

// The public feed reuses the timeline `Posts` client component; stub it so the
// test focuses on the landing's variant selection and prop forwarding.
jest.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    currentTime,
    statuses
  }: {
    currentTime: number
    statuses: Status[]
  }) => (
    <div
      data-testid="posts"
      data-current-time={currentTime}
      data-current-time-type={typeof currentTime}
      data-count={statuses.length}
    />
  )
}))

const renderLanding = (statuses: Status[]) =>
  render(
    <Landing
      host="llun.social"
      currentTime={1_700_000_000_000}
      statuses={statuses}
      serviceName="Activities"
    />
  )

describe('Landing', () => {
  it('shows the brand hero when there are no public posts', () => {
    renderLanding([])

    expect(
      screen.getByText('Posts and fitness activity, on a server you own.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
    // Auth card is always present.
    expect(screen.getByText('Join Activities')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Create account' })
    ).toHaveAttribute('href', '/auth/signup')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/signin'
    )
  })

  it('previews the public feed when the server has public posts', () => {
    renderLanding([{ id: 'p1' }, { id: 'p2' }] as unknown as Status[])

    const posts = screen.getByTestId('posts')
    expect(posts).toBeInTheDocument()
    expect(posts).toHaveAttribute('data-count', '2')
    expect(screen.getByText('llun.social')).toBeInTheDocument()
    expect(screen.queryByText('happening next.')).not.toBeInTheDocument()
  })

  it('forwards currentTime to the feed as a number (no in-render Date.now)', () => {
    renderLanding([{ id: 'p1' }] as unknown as Status[])

    const posts = screen.getByTestId('posts')
    expect(posts).toHaveAttribute('data-current-time-type', 'number')
    expect(posts).toHaveAttribute('data-current-time', '1700000000000')
  })
})

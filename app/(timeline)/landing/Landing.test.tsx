/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Status } from '@/lib/types/domain/status'

import { Landing } from './Landing'

// The public feed reuses the timeline `Posts` client component; stub it so the
// test focuses on the landing's variant selection and prop forwarding.
vi.mock('@/lib/components/posts/posts', () => ({
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

const renderLanding = (statuses: Status[], signupOpen?: boolean) =>
  render(
    <Landing
      host="llun.social"
      currentTime={1_700_000_000_000}
      statuses={statuses}
      serviceName="Activities"
      signupOpen={signupOpen}
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

  it('lets the feed wrapper grow with the feed so the bar sticks the whole scroll', () => {
    renderLanding([{ id: 'p1' }] as unknown as Status[])

    // The bar is `sticky` inside this wrapper, so any height that tracks the
    // scrolling column (`h-full`, `min-h-full`, `h-dvh`, `min-h-0`,
    // `max-h-full`, their `md:` forms) shrinks it back to the viewport and the
    // bar stops sticking after the first screen at md+. `overflow-*` can too:
    // `-hidden` clips the feed at md+; unprefixed `-hidden`/`-auto`/`-scroll`
    // let the bar scroll away below md. `-clip` is harmless, banned anyway.
    // jsdom has no layout, so the contract is "no height, size or overflow
    // utility at all"; nothing here needs even `h-auto`.
    const wrapper = screen
      .getByText('llun.social')
      .closest('.sticky')?.parentElement
    // The bar's parent is the element that holds the feed (not a bar-sized box).
    expect(wrapper).toContainElement(screen.getByTestId('posts'))
    const sizing = Array.from(wrapper?.classList ?? []).filter((name) =>
      /(?:^|:)!?(?:(?:(?:min-|max-)?h|size)-|overflow-)/.test(name)
    )
    expect(sizing).toEqual([])
  })

  it('forwards currentTime to the feed as a number (no in-render Date.now)', () => {
    renderLanding([{ id: 'p1' }] as unknown as Status[])

    const posts = screen.getByTestId('posts')
    expect(posts).toHaveAttribute('data-current-time-type', 'number')
    expect(posts).toHaveAttribute('data-current-time', '1700000000000')
  })

  it('shows the registration-closed auth card when sign-up is closed', () => {
    renderLanding([], false)

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('Registration is closed')).toBeInTheDocument()
    // Sign-in only — no "Create account" path.
    expect(
      screen.queryByRole('link', { name: 'Create account' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/signin'
    )
  })

  it('still previews the public feed when sign-up is closed', () => {
    renderLanding([{ id: 'p1' }] as unknown as Status[], false)

    // The left column (feed vs hero) is independent of the auth card variant.
    expect(screen.getByTestId('posts')).toBeInTheDocument()
    expect(screen.getByText('Registration is closed')).toBeInTheDocument()
  })
})

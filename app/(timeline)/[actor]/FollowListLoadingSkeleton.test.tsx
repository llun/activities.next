/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import { FollowListLoadingSkeleton } from './FollowListLoadingSkeleton'

describe('FollowListLoadingSkeleton', () => {
  it.each([
    ['Loading followers', 'followers'],
    ['Loading following', 'following']
  ] as const)('is busy and announces one polite status: %s', (label, route) => {
    const { container } = render(
      <FollowListLoadingSkeleton label={label} route={route} />
    )

    expect(screen.getByRole('status')).toHaveTextContent(label)
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  // Signed in, below `md` the loaded page puts its plain title in the compact
  // bar and starts the content with a 44px Back row. A skeleton title in
  // the bar, or no row, made the list jump down when it arrived.
  describe('below md', () => {
    const renderInShell = (route: 'followers' | 'following') =>
      render(
        <MobileNavigationProvider>
          <FollowListLoadingSkeleton label={`Loading ${route}`} route={route} />
        </MobileNavigationProvider>
      )

    it.each([
      ['followers', 'Followers'],
      ['following', 'Following']
    ] as const)(
      'names the %s page in the compact bar with a plain title',
      (route, title) => {
        const { container } = renderInShell(route)

        const bar = container.querySelector(
          '[data-mobile-compact-header]'
        ) as HTMLElement
        expect(bar).toBeInTheDocument()
        expect(within(bar).getByText(title)).toHaveAttribute('title', title)
        expect(bar.querySelector('.skeleton')).toBeNull()
      }
    )
  })
})

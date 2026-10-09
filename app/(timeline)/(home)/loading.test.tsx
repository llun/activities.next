/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import Loading from './loading'

describe('timeline loading', () => {
  it('is busy and announces one polite "Loading timeline"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading timeline')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('outlines the header, post composer and a framed list of posts', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).toBeInTheDocument()
    const composer = screen.getByLabelText('Post composer')
    expect(composer).toBeInTheDocument()
    const posts = container.querySelector('[data-slot="post-list-skeleton"]')
    expect(posts).toBeInTheDocument()
    expect(posts?.children).toHaveLength(3)
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading timeline$/)
  })

  it('is scoped to the home route group so it does not cascade to other (timeline) subroutes', () => {
    // Next.js cascades loading.tsx to all nested route segments in the same
    // directory tree. To prevent TimelineLoading from appearing on /notifications,
    // /bookmarks, /settings, etc., it must remain in (home)/ and not at the root
    // of (timeline)/.
    const rootTimelineLoadingPath = path.resolve(
      process.cwd(),
      'app/(timeline)/loading.tsx'
    )
    expect(fs.existsSync(rootTimelineLoadingPath)).toBe(false)
  })

  it('shows the compact mobile bar only where the signed-in shell provides it', () => {
    const loggedOut = render(<Loading />)
    expect(
      loggedOut.container.querySelector('[data-mobile-compact-header]')
    ).not.toBeInTheDocument()
    loggedOut.unmount()

    const signedIn = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )
    // The bar carries the title and the Refresh placeholder, so the page does
    // not jump when it replaces the skeleton.
    expect(
      signedIn.container.querySelector('[data-mobile-compact-header]')
    ).toBeInTheDocument()
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import Loading from './loading'

describe('[actor] loading', () => {
  it('is busy and announces one polite "Loading profile"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading profile')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('shows the profile and post list shapes with no loading text', () => {
    const { container } = render(<Loading />)

    expect(screen.getByLabelText('Profile')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="post-list-skeleton"]')
    ).toBeInTheDocument()
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading profile$/)
  })

  it('floats the menu button only where the signed-in shell provides it', () => {
    const loggedOut = render(<Loading />)
    expect(
      loggedOut.container.querySelector('[data-floating-nav-trigger]')
    ).not.toBeInTheDocument()
    loggedOut.unmount()

    const signedIn = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )
    // The page floats the button over the cover; an in-flow bar variant here
    // would shift the layout when the page replaces the skeleton.
    expect(
      signedIn.container.querySelector('[data-floating-nav-trigger]')
    ).toBeInTheDocument()
  })
})

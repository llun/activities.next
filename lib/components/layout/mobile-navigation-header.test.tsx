/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from './mobile-navigation-context'
import { MobileNavigationHeader } from './mobile-navigation-header'

describe('MobileNavigationHeader', () => {
  it('renders null outside of MobileNavigationProvider', () => {
    const { container } = render(<MobileNavigationHeader />)
    expect(container.firstChild).toBeNull()
  })

  it('renders trigger and logo when inside MobileNavigationProvider', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationHeader />
      </MobileNavigationProvider>
    )

    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Activities home' })
    ).toBeInTheDocument()
  })
})

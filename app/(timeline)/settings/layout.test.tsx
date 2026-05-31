/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn()
}))

const renderLayout = () =>
  render(
    <Layout>
      <div>content</div>
    </Layout>
  )

describe('Settings Layout', () => {
  it('marks the most-specific tab as the current page', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/account')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(rail).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(rail).getByRole('link', { name: 'General' })
    ).not.toHaveAttribute('aria-current')
  })

  it('resolves a nested account path to the Account tab, not General', () => {
    ;(usePathname as jest.Mock).mockReturnValue(
      '/settings/account/verify-email'
    )
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(rail).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    // '/settings' is a prefix of the path but must not win over '/settings/account'.
    expect(
      within(rail).getByRole('link', { name: 'General' })
    ).not.toHaveAttribute('aria-current')
  })

  it('renders the section-level Settings header above the rail', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Settings' })
    const rail = screen.getByRole('navigation', { name: 'Settings' })

    // The shared "Settings" header must precede the nav rail so every settings
    // page leads with the same full-width chrome the other top-level routes use.
    expect(
      heading.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText('Manage your account and preferences')
    ).toBeInTheDocument()
  })

  it('marks General as current on the settings root', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
    renderLayout()

    const rail = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(rail).getByRole('link', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})

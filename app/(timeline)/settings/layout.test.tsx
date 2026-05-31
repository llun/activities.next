/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
  it('reflects the most-specific tab in the dropdown trigger', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/account')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Account')
  })

  it('resolves a nested account path to the Account tab, not General', () => {
    ;(usePathname as jest.Mock).mockReturnValue(
      '/settings/account/verify-email'
    )
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    // '/settings' is a prefix of the path but must not win over '/settings/account'.
    expect(within(nav).getByRole('button')).toHaveTextContent('Account')
  })

  it('renders the section-level Settings header above the dropdown nav', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Settings' })
    const nav = screen.getByRole('navigation', { name: 'Settings' })

    // The shared "Settings" header must precede the dropdown nav so every
    // settings page leads with the same full-width chrome the other top-level
    // routes use.
    expect(
      heading.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText('Manage your account and preferences')
    ).toBeInTheDocument()
  })

  it('reflects the General tab in the dropdown trigger on the settings root', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('button')).toHaveTextContent('General')
  })

  // Open the Radix menu the same way the rest of the suite does (keyboard, since
  // jsdom has no pointer layout), then assert the items the rail used to expose.
  it('renders every section as a menu item when the dropdown is opened', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
    renderLayout()

    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' })

    expect(
      await screen.findByRole('menuitem', { name: 'General' })
    ).toBeInTheDocument()
    for (const label of [
      'Account',
      'Media',
      'Notifications',
      'Blocked accounts',
      'Muted accounts',
      'Sessions'
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
  })

  it('marks the active section as current in the opened dropdown', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/account')
    renderLayout()

    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' })

    expect(
      await screen.findByRole('menuitem', { name: 'Account' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('menuitem', { name: 'General' })
    ).not.toHaveAttribute('aria-current')
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({
    getActorsForAccount: vi.fn().mockResolvedValue([{}, {}, {}])
  }))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'anna@llun.test' }
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue({
    id: 'https://llun.test/users/anna',
    username: 'anna',
    domain: 'llun.test',
    iconUrl: null,
    account: { id: 'acct-1', email: 'anna@llun.test' }
  })
}))

const renderLayout = async (pathname: string) => {
  ;(usePathname as jest.Mock).mockReturnValue(pathname)
  render(await Layout({ children: <div>content</div> }))
}

const openMenu = async () => {
  const nav = screen.getByRole('navigation', { name: 'Account & security' })
  fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

describe('Account Layout', () => {
  it('names the account email in the section header', async () => {
    await renderLayout('/account/security')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Account & security' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Shared across your profiles · anna@llun.test')
    ).toBeInTheDocument()
  })

  it('has no email in the header when signed out', async () => {
    vi.mocked(getActorFromSession).mockResolvedValueOnce(null as never)
    await renderLayout('/account/security')

    expect(screen.getByText('Shared across your profiles')).toBeInTheDocument()
    expect(screen.queryByText(/anna@llun\.test/)).not.toBeInTheDocument()
  })

  it('renders no section chrome when signed out', async () => {
    vi.mocked(getActorFromSession).mockResolvedValueOnce(null as never)
    await renderLayout('/account/verify-email')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Account & security' })
    ).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Account & security' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /all pages/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Settings for/ })).toBeNull()
  })

  it('lists the five sections in order and the settings row', async () => {
    await renderLayout('/account/security')
    // Before the menu opens: Radix hides everything outside an open menu.
    const nav = screen.getByRole('navigation', { name: 'Account & security' })
    expect(within(nav).getByRole('button')).toBeInTheDocument()
    const menu = await openMenu()

    const items = within(menu).getAllByRole('menuitem')
    expect(
      items.slice(0, 5).map((l) => [l.textContent, l.getAttribute('href')])
    ).toEqual([
      ['Email & name', '/account/email'],
      ['Password & sign-in', '/account/security'],
      ['Sessions & apps', '/account/sessions'],
      ['Profiles', '/account/profiles'],
      ['Import and export', '/account/import-export']
    ])
    const footer = within(menu).getByRole('menuitem', {
      name: /Settings for @anna@llun.test/
    })
    expect(footer).toHaveAttribute('href', '/settings')
    expect(footer).not.toHaveTextContent('Each profile has its own')
    expect(items).toHaveLength(6)
  })

  it('marks a nested security path as Password & sign-in', async () => {
    await renderLayout('/account/security/passkeys')

    const nav = screen.getByRole('navigation', { name: 'Account & security' })
    expect(within(nav).getByRole('button')).toHaveTextContent(
      'Password & sign-in'
    )
    const menu = await openMenu()
    const current = within(menu)
      .getAllByRole('menuitem')
      .filter((item) => item.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Password & sign-in')
  })

  it('renders the Account link and no Back row on /account/email', async () => {
    await renderLayout('/account/email')

    // jsdom has no CSS, so both spans of the link are in its name (only
    // `max-md:hidden` / `md:hidden` hide one) and drops the space before the
    // visually hidden suffix; assert the pieces.
    const link = screen.getByRole('link', {
      name: /^Account & security.*\(all pages\)$/
    })
    expect(link).toHaveAttribute('href', '/account')
    expect(within(link).getByText('Account & security')).toHaveClass(
      'max-md:hidden'
    )
    expect(within(link).getByText('Account')).toHaveClass('md:hidden')
    expect(
      screen.queryByRole('link', { name: /^Back/ })
    ).not.toBeInTheDocument()
  })

  it('names Email & name on a signed-in verify-email page', async () => {
    await renderLayout('/account/verify-email')

    const nav = screen.getByRole('navigation', { name: 'Account & security' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Email & name')
    const menu = await openMenu()
    expect(
      within(menu).getByRole('menuitem', { name: 'Email & name' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.queryByRole('link', { name: /^Back/ })
    ).not.toBeInTheDocument()
  })

  it('renders the index list and no dropdown row on /account', async () => {
    await renderLayout('/account')

    expect(
      screen.queryByRole('navigation', { name: 'Account & security' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'For this profile' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Profiles/ })).toHaveTextContent(
      '3 profiles: switch, set the default, add one'
    )
  })
})

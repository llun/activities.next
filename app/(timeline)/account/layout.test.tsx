/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
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
    expect(screen.queryByRole('link', { name: /Settings for/ })).toBeNull()
  })

  it('lists the four sections in order and the settings card', async () => {
    await renderLayout('/account/security')

    const nav = screen.getByRole('navigation', { name: 'Account & security' })
    const links = within(nav).getAllByRole('link')
    expect(
      links.slice(0, 4).map((l) => [l.textContent, l.getAttribute('href')])
    ).toEqual([
      ['Email & name', '/account/email'],
      ['Password & sign-in', '/account/security'],
      ['Sessions & apps', '/account/sessions'],
      ['Profiles', '/account/profiles']
    ])
    const footer = within(nav).getByRole('link', {
      name: /Settings for @anna@llun.test/
    })
    expect(footer).toHaveAttribute('href', '/settings')
    expect(footer).toHaveTextContent('Each profile has its own')
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
  })

  it('marks a nested security path as Password & sign-in', async () => {
    await renderLayout('/account/security/passkeys')

    const nav = screen.getByRole('navigation', { name: 'Account & security' })
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Password & sign-in')
  })

  it('leads a section page with Back to Account & security below lg', async () => {
    await renderLayout('/account/email')

    const back = screen.getByRole('link', {
      name: 'Back to account & security'
    })
    expect(back).toHaveAttribute('href', '/account')
    expect(back).toHaveClass('lg:hidden')
  })

  it('renders the index list instead of the rail on /account', async () => {
    await renderLayout('/account')

    expect(
      screen.queryByRole('navigation', { name: 'Account & security' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'For this profile' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Profiles/ })).toHaveTextContent(
      '3 profiles: switch, set the default, add one'
    )
  })
})

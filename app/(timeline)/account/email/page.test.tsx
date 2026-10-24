/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

const getActorFromSession = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'user@llun.test' }
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => getActorFromSession(...args)
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}))

const actorWithAccount = (emailVerifiedAt: number | null) => ({
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  account: {
    id: 'acct-1',
    email: 'anna@llun.test',
    name: 'Anna',
    iconUrl: null,
    emailVerifiedAt
  }
})

describe('/account/email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorFromSession.mockResolvedValue(actorWithAccount(null))
  })

  it('renders the email, account name and account photo sections', async () => {
    const { container } = render(
      await Page({ searchParams: Promise.resolve({}) })
    )

    expect(
      screen.getByRole('heading', { name: 'Email address' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Current email')).toHaveValue('anna@llun.test')
    expect(
      screen.getByRole('heading', { name: 'Account name' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Account name')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Account photo' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Account photo', { selector: 'label' })
    ).toBeInTheDocument()
    expect(
      container.querySelector('form[action="/api/v1/accounts/image"]')
    ).toHaveAttribute('method', 'post')
  })

  it('links the profile hints to Edit profile', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))

    const links = screen.getAllByRole('link', { name: 'Edit profile' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/settings/profile')
    }
  })

  it('shows the upload error from the query', async () => {
    render(
      await Page({
        searchParams: Promise.resolve({ error: 'Invalid image URL' })
      })
    )

    expect(screen.getByText('Invalid image URL')).toBeInTheDocument()
  })

  it('shows the Verified badge only for a verified email', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()

    getActorFromSession.mockResolvedValue(actorWithAccount(1))
    render(await Page({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

const getAccountWithActors = vi.fn()
const mockDatabase = { getAccountWithActors }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('Unexpected notFound')
  })
}))

const account = (overrides: Record<string, unknown>) => ({
  id: 'acct-1',
  email: 'user@llun.test',
  name: 'User',
  role: null,
  createdAt: 1_700_000_000_000,
  ...overrides
})

const renderPage = async () =>
  render(await Page({ params: Promise.resolve({ id: 'acct-1' }) }))

describe('/admin/accounts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks an admin account in the header with the shared primary Badge', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({ role: 'admin' }),
      actors: []
    })

    await renderPage()

    const badge = screen.getByText('Admin', { selector: 'span' })
    expect(badge).toHaveClass('bg-primary/10', 'text-primary-text', 'px-2.5')
    expect(badge.className).toContain('dark:bg-[#FA802E]/16')
  })

  it('leaves a regular account without a header badge', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({ role: null }),
      actors: []
    })

    await renderPage()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('User')
    expect(screen.queryByText('Admin', { selector: 'span' })).toBeNull()
  })
})

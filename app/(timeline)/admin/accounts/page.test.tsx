/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

const getAllAccounts = vi.fn()
const mockDatabase = { getAllAccounts }

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

describe('/admin/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks an admin account with the shared primary Badge', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [
        account({
          id: 'a1',
          email: 'boss@llun.test',
          name: 'Boss',
          role: 'admin'
        })
      ],
      total: 1
    })

    render(await Page({ searchParams: Promise.resolve({}) }))

    const badge = screen.getByText('Admin')
    expect(badge).toHaveClass('bg-primary/10', 'text-primary-text', 'px-2.5')
    // The design's dark tint, which the hand-rolled pill (`bg-primary/10` only)
    // never had.
    expect(badge.className).toContain('dark:bg-[#FA802E]/16')
  })

  it('leaves a regular account without a badge', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [account({ id: 'a2', role: null })],
      total: 1
    })

    render(await Page({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })
})

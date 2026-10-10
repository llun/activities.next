/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

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

const renderPage = async (searchParams: Record<string, string> = {}) =>
  render(await Page({ searchParams: Promise.resolve(searchParams) }))

describe('/admin/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists accounts in a table of account, email, role and joined', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [
        account({
          id: 'a1',
          email: 'boss@llun.test',
          name: 'Boss',
          role: 'admin'
        }),
        account({ id: 'a2', email: 'user@llun.test', name: 'User' })
      ],
      total: 2
    })

    await renderPage()

    const table = screen.getByRole('table', { name: 'Accounts' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual(['Account', 'Email', 'Role', 'Joined'])
    const [, admin, member] = within(table).getAllByRole('row')
    expect(within(admin).getByRole('link', { name: 'Boss' })).toHaveAttribute(
      'href',
      '/admin/accounts/a1'
    )
    // Each value is a cell of its own column (the phone folds them into a
    // second line under the account, which is hidden from `sm`).
    const adminCells = within(admin).getAllByRole('cell')
    expect(adminCells[1]).toHaveTextContent('boss@llun.test')
    expect(adminCells[2]).toHaveTextContent('Admin')
    const memberCells = within(member).getAllByRole('cell')
    expect(memberCells[1]).toHaveTextContent('user@llun.test')
    expect(memberCells[2]).toHaveTextContent('Member')
  })

  it('marks an admin account and leaves a regular one unmarked', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [
        account({ id: 'a1', name: 'Boss', role: 'admin' }),
        account({ id: 'a2', role: null })
      ],
      total: 2
    })

    await renderPage()

    const [, admin, member] = screen.getAllByRole('row')
    expect(within(admin).getAllByRole('cell')[2]).toHaveTextContent('Admin')
    expect(within(member).getAllByRole('cell')[2]).toHaveTextContent('Member')
    expect(within(member).queryByText('Admin')).not.toBeInTheDocument()
  })

  it('falls back to the email when an account has no name', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [account({ id: 'a3', name: '', email: 'anon@llun.test' })],
      total: 1
    })

    await renderPage()

    expect(
      screen.getByRole('link', { name: 'anon@llun.test' })
    ).toHaveAttribute('href', '/admin/accounts/a3')
  })

  it('says so when there are no accounts', async () => {
    getAllAccounts.mockResolvedValue({ accounts: [], total: 0 })

    await renderPage()

    expect(screen.getByText('No accounts found')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('pages through the accounts under the table', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [account({ id: 'a21' })],
      total: 45
    })

    await renderPage({ page: '2' })

    expect(getAllAccounts).toHaveBeenCalledWith({ limit: 20, offset: 20 })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/admin/accounts?page=1'
    )
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/admin/accounts?page=3'
    )
  })

  it('keeps the offset of a huge page number in the safe-integer range', async () => {
    getAllAccounts.mockResolvedValue({ accounts: [], total: 0 })

    await renderPage({ page: '100000000000000000000' })

    // 1e21 as a bound parameter makes SQLite and PostgreSQL throw.
    expect(getAllAccounts).toHaveBeenCalledWith({
      limit: 20,
      offset: Number.MAX_SAFE_INTEGER
    })
  })

  it('has no Next link on the last page', async () => {
    getAllAccounts.mockResolvedValue({
      accounts: [account({ id: 'a41' })],
      total: 41
    })

    await renderPage({ page: '3' })

    expect(screen.queryByRole('link', { name: /Next/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })
})

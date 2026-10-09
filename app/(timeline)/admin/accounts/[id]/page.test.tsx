/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

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

vi.mock('./ActorModerationPanel', () => ({
  ActorModerationPanel: ({ username }: { username: string }) => (
    <div data-testid="moderation">{username}</div>
  )
}))

const account = (overrides: Record<string, unknown>) => ({
  id: 'acct-1',
  email: 'user@llun.test',
  name: 'User',
  role: null,
  createdAt: 1_700_000_000_000,
  ...overrides
})

const actor = (overrides: Record<string, unknown>) => ({
  id: 'https://llun.test/users/alice',
  username: 'alice',
  domain: 'llun.test',
  name: 'Alice',
  createdAt: 1_700_000_000_000,
  deletionStatus: null,
  ...overrides
})

const renderPage = async () =>
  render(await Page({ params: Promise.resolve({ id: 'acct-1' }) }))

describe('/admin/accounts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks an admin account in the header', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({ role: 'admin' }),
      actors: []
    })

    await renderPage()

    expect(
      within(screen.getByRole('heading', { level: 1 })).getByText('Admin')
    ).toBeInTheDocument()
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

  it('puts a "Back" to the accounts list in the first content row', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({ role: null }),
      actors: []
    })

    await renderPage()

    const back = screen.getByRole('link', { name: 'Back to accounts list' })
    expect(back).toHaveAttribute('href', '/admin/accounts')
    expect(within(back).getByText('Back')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).not.toContainElement(back)
  })

  it('lists the account facts as label and value rows', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({ role: 'admin', name: '' }),
      actors: []
    })

    await renderPage()

    const details = screen
      .getByRole('heading', { level: 2, name: 'Account details' })
      .closest('section') as HTMLElement
    const terms = within(details)
      .getAllByRole('term')
      .map((term) => term.textContent)
    expect(terms).toEqual(['Email', 'Name', 'Created', 'Role'])
    // No name on file shows a dash, not an empty value.
    expect(within(details).getByText('—')).toBeInTheDocument()
    expect(within(details).getByText('user@llun.test')).toBeInTheDocument()
  })

  it('gives each actor a row with its own moderation panel', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({}),
      actors: [
        actor({}),
        actor({
          id: 'https://llun.test/users/bob',
          username: 'bob',
          name: '',
          deletionStatus: 'scheduled'
        })
      ]
    })

    await renderPage()

    const list = screen.getByRole('list', { name: 'Actors' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Alice')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('moderation')).toHaveTextContent('alice')
    // An actor on its way out shows that instead of its created date.
    expect(within(rows[1]).getByText('scheduled')).toBeInTheDocument()
    expect(
      within(rows[1]).getByText('bob', { selector: 'p' })
    ).toBeInTheDocument()
  })

  it('says so when the account has no actors', async () => {
    getAccountWithActors.mockResolvedValue({
      account: account({}),
      actors: []
    })

    await renderPage()

    expect(screen.getByText('No actors')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Actors' })).toBeNull()
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

const getActorsForAccount = vi.fn()
const mockDatabase = { getActorsForAccount }
const getActorFromSession = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
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
    throw new Error(`Unexpected redirect to ${path}`)
  }),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}))

const actorWithAccount = (emailVerifiedAt: number | null) => ({
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  name: 'Anna',
  iconUrl: null,
  account: {
    id: 'acct-1',
    email: 'anna@llun.test',
    name: 'Anna',
    iconUrl: null,
    defaultActorId: null,
    emailVerifiedAt
  }
})

describe('/account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorsForAccount.mockResolvedValue([])
  })

  it('shows no badge while the email is unverified', async () => {
    getActorFromSession.mockResolvedValue(actorWithAccount(null))

    render(await Page({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })
})

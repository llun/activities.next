/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

const mockGetActorsForAccount = vi.fn()
const mockGetNotificationsCount = vi.fn()
const mockGetLists = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({
    getActorsForAccount: mockGetActorsForAccount,
    getNotificationsCount: mockGetNotificationsCount,
    getLists: mockGetLists
  }))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/types/domain/actor', () => ({
  getActorProfile: (actor: unknown) => actor,
  getMention: () => '@testuser@localhost'
}))

vi.mock('@/app/Modal', () => ({ Modal: () => <div data-testid="modal" /> }))
vi.mock('@/lib/components/layout/sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />
}))
vi.mock('@/lib/components/layout/mobile-nav', () => ({
  MobileNav: () => <div data-testid="mobile-nav" />
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const renderLayout = async () => {
  const element = await Layout({
    children: <div data-testid="child" />
  })
  render(element)
}

describe('(timeline) Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorsForAccount.mockResolvedValue([])
    mockGetNotificationsCount.mockResolvedValue(0)
    mockGetLists.mockResolvedValue([])
  })

  it('renders children without nav chrome for logged-out visitors', async () => {
    // Logged-out visitors render chrome-less here: the home route renders a
    // full-bleed landing, and the federated reading surfaces add the public
    // top bar + footer via their own sub-layouts (PublicShell).
    mockGetActorFromSession.mockResolvedValue(null)

    await renderLayout()

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mobile-nav')).not.toBeInTheDocument()
  })

  it('renders the nav chrome for signed-in users', async () => {
    mockGetActorFromSession.mockResolvedValue({
      id: 'https://localhost/users/testuser',
      username: 'testuser',
      domain: 'localhost',
      name: 'Test User',
      iconUrl: null,
      account: { id: 'account-1', role: 'user' }
    } as never)

    await renderLayout()

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})

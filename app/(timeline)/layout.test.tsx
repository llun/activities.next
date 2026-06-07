/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

const mockGetActorsForAccount = jest.fn()
const mockGetNotificationsCount = jest.fn()

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn(() => ({
    getActorsForAccount: mockGetActorsForAccount,
    getNotificationsCount: mockGetNotificationsCount
  }))
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn()
}))

jest.mock('@/lib/types/domain/actor', () => ({
  getActorProfile: (actor: unknown) => actor,
  getMention: () => '@testuser@localhost'
}))

jest.mock('@/app/Modal', () => ({ Modal: () => <div data-testid="modal" /> }))
jest.mock('./PublicTopBar', () => ({
  PublicTopBar: () => <div data-testid="public-topbar" />
}))
jest.mock('./PublicFooter', () => ({
  PublicFooter: () => <div data-testid="public-footer" />
}))
jest.mock('@/lib/components/layout/sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />
}))
jest.mock('@/lib/components/layout/mobile-nav', () => ({
  MobileNav: () => <div data-testid="mobile-nav" />
}))

const mockGetServerAuthSession = jest.mocked(getServerAuthSession)
const mockGetActorFromSession = jest.mocked(getActorFromSession)

const renderLayout = async () => {
  const element = await Layout({
    children: <div data-testid="child" />
  })
  render(element)
}

describe('(timeline) Layout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorsForAccount.mockResolvedValue([])
    mockGetNotificationsCount.mockResolvedValue(0)
  })

  it('renders the public chrome and no nav for logged-out visitors', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    await renderLayout()

    expect(screen.getByTestId('public-topbar')).toBeInTheDocument()
    expect(screen.getByTestId('public-footer')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mobile-nav')).not.toBeInTheDocument()
  })

  it('renders the nav chrome and no public chrome for signed-in users', async () => {
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
    expect(screen.queryByTestId('public-topbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('public-footer')).not.toBeInTheDocument()
  })
})

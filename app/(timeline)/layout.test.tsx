/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

const mockGetActorsForAccount = vi.fn()
const mockGetNotificationsCount = vi.fn()
const mockGetLists = vi.fn()
const mockGetAllServerSettings = vi.fn()
const mockGetActorSettings = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({
    getActorsForAccount: mockGetActorsForAccount,
    getNotificationsCount: mockGetNotificationsCount,
    getLists: mockGetLists,
    getAllServerSettings: mockGetAllServerSettings,
    getActorSettings: mockGetActorSettings
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

// Stubbed so the assertions can read the limit the layout publishes without
// rendering a composer.
vi.mock('@/lib/components/instance-limits', () => ({
  InstanceLimitsProvider: ({
    maxStatusCharacters,
    children
  }: {
    maxStatusCharacters?: number
    children: ReactNode
  }) => (
    <div data-testid="instance-limits" data-max={maxStatusCharacters}>
      {children}
    </div>
  )
}))

// Stubbed like the nav components below: the assertions only care that the
// layout seeds it from the actor's saved settings, not how it stores them.
vi.mock('@/lib/components/layout/nav-preferences-context', () => ({
  NavPreferencesProvider: ({
    initialOrder,
    initialHidden,
    children
  }: {
    initialOrder?: string[]
    initialHidden?: string[]
    children: ReactNode
  }) => (
    <div
      data-testid="nav-preferences"
      data-order={initialOrder?.join(',')}
      data-hidden={initialHidden?.join(',')}
    >
      {children}
    </div>
  )
}))

vi.mock('@/app/Modal', () => ({ Modal: () => <div data-testid="modal" /> }))
vi.mock('@/lib/components/layout/sidebar', () => ({
  Sidebar: ({ fitnessUrl }: { fitnessUrl?: string }) => (
    <div data-testid="sidebar" data-fitness={fitnessUrl ?? ''} />
  )
}))
vi.mock('@/lib/components/layout/mobile-nav', () => ({
  MobileNav: () => <div data-testid="mobile-nav" />
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const signedInActor = {
  id: 'https://localhost/users/testuser',
  username: 'testuser',
  domain: 'localhost',
  name: 'Test User',
  iconUrl: null,
  account: { id: 'account-1', role: 'user' }
}

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
    mockGetActorSettings.mockResolvedValue(undefined)
    mockGetAllServerSettings.mockResolvedValue([
      { key: 'posts.maxCharacters', value: 1000 }
    ])
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
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)

    await renderLayout()

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('seeds the navigation store from the actor settings', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockGetActorSettings.mockResolvedValue({
      navOrder: ['settings', 'timeline'],
      navHidden: ['favorites']
    })

    await renderLayout()

    const store = screen.getByTestId('nav-preferences')
    expect(store).toHaveAttribute('data-order', 'settings,timeline')
    expect(store).toHaveAttribute('data-hidden', 'favorites')
  })

  it('drops fitness from navigation when the instance turns the feature off', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockGetAllServerSettings.mockResolvedValue([
      { key: 'features.fitness', value: false }
    ])

    await renderLayout()

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-fitness', '')
  })

  it.each([
    { description: 'signed-in visitors', actor: signedInActor },
    { description: 'logged-out visitors', actor: null }
  ])(
    'publishes the resolved status character limit to $description',
    async ({ actor }) => {
      mockGetActorFromSession.mockResolvedValue(actor as never)

      await renderLayout()

      expect(screen.getByTestId('instance-limits')).toHaveAttribute(
        'data-max',
        '1000'
      )
    }
  )
})

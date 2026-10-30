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
const mockCountOpenReports = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({
    getActorsForAccount: mockGetActorsForAccount,
    getNotificationsCount: mockGetNotificationsCount,
    getLists: mockGetLists,
    getAllServerSettings: mockGetAllServerSettings,
    getActorSettings: mockGetActorSettings,
    countOpenReports: mockCountOpenReports
  }))
}))

// The visited domain's own switches (Admin › Served domains): none turned off unless
// a test says so.
const mockDisabledFeatures = vi.hoisted(() => ({ list: [] as string[] }))
vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn(async () => ({
    disabledFeatures: mockDisabledFeatures.list
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
    maxMediaAttachments,
    children
  }: {
    maxStatusCharacters?: number
    maxMediaAttachments?: number
    children: ReactNode
  }) => (
    <div
      data-testid="instance-limits"
      data-max={maxStatusCharacters}
      data-max-media-attachments={maxMediaAttachments}
    >
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

vi.mock('@/lib/components/connection/ConnectionStatus', () => ({
  ConnectionAnnouncer: () => <div data-testid="connection-announcer" />,
  ConnectionStatusBar: () => <div data-testid="connection-bar" />,
  ConnectionStatusStrip: () => <div data-testid="connection-strip" />
}))
vi.mock('@/lib/components/drafts/DraftsProvider', () => ({
  DraftsProvider: ({
    accountId,
    actorId,
    children
  }: {
    accountId: string
    actorId: string
    children: ReactNode
  }) => (
    <div
      data-testid="drafts-provider"
      data-account-id={accountId}
      data-actor-id={actorId}
    >
      {children}
    </div>
  )
}))

vi.mock('@/app/Modal', () => ({ Modal: () => <div data-testid="modal" /> }))
vi.mock('@/lib/components/layout/sidebar', () => ({
  Sidebar: ({
    fitnessUrl,
    openReportCount
  }: {
    fitnessUrl?: string
    openReportCount?: number
  }) => (
    <div
      data-testid="sidebar"
      data-fitness={fitnessUrl ?? ''}
      data-open-reports={openReportCount}
    />
  )
}))
vi.mock('@/lib/components/session-keep-alive', () => ({
  SessionKeepAlive: () => <div data-testid="session-keep-alive" />
}))
vi.mock('@/lib/components/layout/mobile-nav', () => ({
  MobileNav: ({
    unreadCount,
    openReportCount
  }: {
    unreadCount?: number
    openReportCount?: number
  }) => (
    <div
      data-testid="mobile-nav"
      data-unread={unreadCount}
      data-open-reports={openReportCount}
    />
  )
}))
vi.mock('@/lib/components/layout/mobile-navigation-context', () => ({
  MobileNavigationProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="mobile-nav-provider">{children}</div>
  )
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
    mockDisabledFeatures.list = []
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorsForAccount.mockResolvedValue([])
    mockGetNotificationsCount.mockResolvedValue(0)
    mockCountOpenReports.mockResolvedValue(3)
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
    // No provider either: a mounted one would put the compact bar and the
    // floating menu button on pages that must render as they did on main.
    expect(screen.queryByTestId('mobile-nav-provider')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-keep-alive')).not.toBeInTheDocument()
  })

  it('renders the nav chrome for signed-in users', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)

    await renderLayout()

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('counts the open reports for an admin and hands the count to both navs', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...signedInActor,
      account: { id: 'account-1', role: 'admin' }
    } as never)

    await renderLayout()

    expect(mockCountOpenReports).toHaveBeenCalledWith({ limit: 100 })
    expect(screen.getByTestId('sidebar')).toHaveAttribute(
      'data-open-reports',
      '3'
    )
    expect(screen.getByTestId('mobile-nav')).toHaveAttribute(
      'data-open-reports',
      '3'
    )
  })

  it('does not count reports for a non-admin', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)

    await renderLayout()

    expect(mockCountOpenReports).not.toHaveBeenCalled()
    expect(screen.getByTestId('sidebar')).toHaveAttribute(
      'data-open-reports',
      '0'
    )
    expect(screen.getByTestId('mobile-nav')).toHaveAttribute(
      'data-open-reports',
      '0'
    )
  })

  it('mounts the drafts provider, the status bar and the announcer for signed-in users', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)

    await renderLayout()

    const provider = screen.getByTestId('drafts-provider')
    expect(provider).toHaveAttribute('data-account-id', 'account-1')
    expect(provider).toHaveAttribute('data-actor-id', signedInActor.id)
    // The provider wraps the nav too (the Drafts badge) and the page.
    expect(provider).toContainElement(screen.getByTestId('sidebar'))
    expect(provider).toContainElement(screen.getByTestId('child'))
    // The bar is the first thing in the content column; the announcer is once.
    const bar = screen.getByTestId('connection-bar')
    expect(bar.nextElementSibling).toBe(screen.getByTestId('child'))
    expect(screen.getAllByTestId('connection-announcer')).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      screen.getByTestId('connection-announcer')
    )
  })

  it('mounts none of the drafts or connection chrome for logged-out visitors', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    await renderLayout()

    expect(screen.queryByTestId('drafts-provider')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connection-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connection-announcer')).not.toBeInTheDocument()
  })

  it('mounts SessionKeepAlive for signed-in users', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)

    await renderLayout()

    expect(screen.getByTestId('session-keep-alive')).toBeInTheDocument()
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

  it('shows fitness when the server has it on and the domain has not turned it off', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockDisabledFeatures.list = ['explore', 'messages']

    await renderLayout()

    expect(screen.getByTestId('sidebar')).toHaveAttribute(
      'data-fitness',
      '/fitness'
    )
  })

  it('drops fitness from navigation when the visited domain turns it off', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockDisabledFeatures.list = ['fitness']

    await renderLayout()

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-fitness', '')
  })

  it('does not turn a feature the server has off back on for a domain', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockGetAllServerSettings.mockResolvedValue([
      { key: 'features.fitness', value: false }
    ])
    mockDisabledFeatures.list = []

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

  it('publishes the resolved media attachment limit to the composer', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockGetAllServerSettings.mockResolvedValue([
      { key: 'posts.maxMediaAttachments', value: 7 }
    ])

    await renderLayout()

    expect(screen.getByTestId('instance-limits')).toHaveAttribute(
      'data-max-media-attachments',
      '7'
    )
  })

  it('wraps signed-in content in MobileNavigationProvider and hands the unread count to the drawer', async () => {
    mockGetActorFromSession.mockResolvedValue(signedInActor as never)
    mockGetNotificationsCount.mockResolvedValue(5)

    await renderLayout()

    const provider = screen.getByTestId('mobile-nav-provider')
    expect(provider).toContainElement(screen.getByTestId('mobile-nav'))
    // The count belongs to the drawer's Notifications row, not the menu
    // button, so it reaches the drawer and nothing else.
    expect(screen.getByTestId('mobile-nav')).toHaveAttribute('data-unread', '5')
  })
})

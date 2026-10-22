/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TimelineRequestError } from '@/lib/client/timelines'
import { OfflineAppShell } from '@/lib/components/offline/OfflineAppShell'

const mockPush = vi.fn()
let mockPathname = '/app'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname
}))

const mockUnsubscribe = vi.fn()
const mockOnConnectionRestored = vi.fn(
  (_listener: () => void) => mockUnsubscribe
)
vi.mock('@/lib/client/connection', () => ({
  onConnectionRestored: (listener: () => void) =>
    mockOnConnectionRestored(listener)
}))

vi.mock('@/lib/components/drafts/DraftsList', () => ({
  DraftsList: (props: any) => (
    <div data-testid="drafts-list">
      {props.host}|{props.profile.username}|{String(props.currentTime)}|
      {String(props.isMediaUploadEnabled)}
    </div>
  )
}))

const mockGetActiveOfflineSession = vi.fn()
const mockGetClientBootstrapSnapshot = vi.fn()
const mockGetOfflineTimeline = vi.fn()
const mockSaveClientBootstrapSnapshot = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/client/offline', () => ({
  getActiveOfflineSession: () => mockGetActiveOfflineSession(),
  getClientBootstrapSnapshot: (actorId: string) =>
    mockGetClientBootstrapSnapshot(actorId),
  getOfflineTimeline: (args: any) => mockGetOfflineTimeline(args),
  saveClientBootstrapSnapshot: (snapshot: any) =>
    mockSaveClientBootstrapSnapshot(snapshot)
}))

const mockGetAccountBootstrap = vi.fn()
vi.mock('@/lib/client/bootstrap', () => ({
  getAccountBootstrap: () => mockGetAccountBootstrap()
}))

vi.mock('@/lib/components/layout/sidebar', () => ({
  Sidebar: (props: { isLoading?: boolean }) => (
    <nav
      data-testid="desktop-sidebar"
      data-loading={props.isLoading ? 'true' : undefined}
    >
      Sidebar
    </nav>
  )
}))

vi.mock('@/lib/components/layout/mobile-nav', () => ({
  MobileNav: () => <nav data-testid="mobile-nav">MobileNav</nav>
}))

vi.mock('@/app/(timeline)/MainPageTimeline', () => ({
  MainPageTimeline: (props: any) => (
    <div data-testid="main-timeline">
      <span>Timeline for {props.profile?.username}</span>
      <button onClick={() => props.onUnauthorized?.()}>Trigger 401</button>
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

vi.mock('@/app/Modal', () => ({
  Modal: () => <div data-testid="modal" />
}))

vi.mock('@/lib/components/session-keep-alive', () => ({
  SessionKeepAlive: () => null
}))

describe('OfflineAppShell', () => {
  const dummyBootstrap = {
    accountId: 'account-1',
    actorId: 'actor-1',
    host: 'llun.social',
    currentTime: Date.now(),
    user: {
      name: 'Alice',
      username: 'alice',
      handle: '@alice@llun.social',
      avatarUrl: 'https://llun.social/files/alice.jpg'
    },
    currentActor: {
      id: 'actor-1',
      username: 'alice',
      domain: 'llun.social',
      name: 'Alice',
      iconUrl: 'https://llun.social/files/alice.jpg'
    },
    actors: [],
    profile: {
      id: 'actor-1',
      username: 'alice',
      domain: 'llun.social'
    },
    unreadCount: 2,
    isAdmin: false,
    isMediaUploadEnabled: true,
    lists: [],
    features: {},
    instanceLimits: {
      maxStatusCharacters: 500,
      maxMediaFileSize: 10000000,
      maxMediaAttachments: 4,
      maxPollOptions: 4,
      maxPollOptionCharacters: 50,
      minPollExpirationSeconds: 300,
      maxPollExpirationSeconds: 604800
    },
    readingAutoplayGifs: false,
    readingGroupBoosts: true,
    savedAt: Date.now()
  }

  const dummyTimeline = {
    actorId: 'actor-1',
    timeline: 'home',
    filterKey: 'all',
    statuses: [
      {
        id: 'status-1',
        actorId: 'actor-1',
        type: 'Note',
        text: 'Cached post',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ],
    segments: [],
    ancestorsById: {},
    nextMaxStatusId: null,
    lastRefreshedAt: Date.now(),
    scrollAnchor: null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPush.mockReset()
    mockPathname = '/app'
    mockOnConnectionRestored.mockClear()
    mockUnsubscribe.mockClear()
    mockGetActiveOfflineSession.mockReset()
    mockGetClientBootstrapSnapshot.mockReset()
    mockGetOfflineTimeline.mockReset()
    mockSaveClientBootstrapSnapshot.mockReset().mockResolvedValue(undefined)
    mockGetAccountBootstrap.mockReset()
  })

  it('renders skeleton in loading state while reading IndexedDB', () => {
    mockGetActiveOfflineSession.mockReturnValue(new Promise(() => {}))
    render(<OfflineAppShell />)

    const loadingRegion = screen.getByRole('status', {
      name: 'Loading offline timeline'
    })
    expect(loadingRegion).toBeInTheDocument()

    const sidebar = screen.getByTestId('desktop-sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveAttribute('data-loading', 'true')

    const mobileNav = screen.getByTestId('mobile-nav')
    expect(mobileNav).toBeInTheDocument()

    const main = screen.getByRole('main')
    expect(main).toHaveClass('md:pl-[72px]', 'xl:pl-[280px]')

    expect(within(main).getByLabelText('Post composer')).toBeInTheDocument()
    expect(
      main.querySelector('[data-slot="post-list-skeleton"]')
    ).toBeInTheDocument()
  })

  it('renders chrome and timeline immediately from IndexedDB and triggers background bootstrap refresh', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce({
      actorId: 'actor-1',
      accountId: 'account-1'
    })
    mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)

    const freshBootstrap = {
      ...dummyBootstrap,
      unreadCount: 5
    }
    mockGetAccountBootstrap.mockResolvedValueOnce(freshBootstrap)

    render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
      expect(screen.getByText('Timeline for alice')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(mockGetAccountBootstrap).toHaveBeenCalled()
      expect(mockSaveClientBootstrapSnapshot).toHaveBeenCalledWith(
        freshBootstrap
      )
    })
  })

  it('mounts the drafts provider, the status bar and the announcer once the shell is ready', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce({
      actorId: 'actor-1',
      accountId: 'account-1'
    })
    mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
    mockGetAccountBootstrap.mockResolvedValueOnce(null)

    render(<OfflineAppShell />)

    const timeline = await screen.findByTestId('main-timeline')
    const provider = screen.getByTestId('drafts-provider')
    expect(provider).toHaveAttribute('data-account-id', 'account-1')
    expect(provider).toHaveAttribute('data-actor-id', 'actor-1')
    expect(provider).toContainElement(screen.getByTestId('desktop-sidebar'))
    expect(provider).toContainElement(timeline)
    expect(screen.getByTestId('connection-bar').nextElementSibling).toBe(
      timeline
    )
    expect(screen.getAllByTestId('connection-announcer')).toHaveLength(1)
  })

  it('redirects to sign in on onUnauthorized callback', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce({
      actorId: 'actor-1',
      accountId: 'account-1'
    })
    mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
    mockGetAccountBootstrap.mockResolvedValueOnce(null)

    render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Trigger 401'))
    expect(mockPush).toHaveBeenCalledWith('/auth/signin')
  })

  it('falls back to network bootstrap when cache is empty and user is online', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce(null)
    mockGetAccountBootstrap.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(null)

    render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
      expect(mockSaveClientBootstrapSnapshot).toHaveBeenCalledWith(
        dummyBootstrap
      )
    })
  })

  it('renders empty-cache-offline empty state when cache is empty and network fails', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce(null)
    mockGetAccountBootstrap.mockRejectedValueOnce(new Error('Network error'))

    render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByText('You are offline')).toBeInTheDocument()
      expect(
        screen.getByText(/No cached timeline found for this device/)
      ).toBeInTheDocument()
    })
  })

  it('renders empty-cache-unauthorized state when cache is empty and bootstrap returns 401', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce(null)
    mockGetAccountBootstrap.mockRejectedValueOnce(
      new TimelineRequestError('Unauthorized', 401)
    )

    render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByText('Not signed in')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    })
  })

  describe('wrapper backdrop', () => {
    const expectNoBackground = (wrapper: Element | null) => {
      expect(wrapper).not.toBeNull()
      expect(wrapper!.className).not.toMatch(/(^|\s)bg-/)
    }

    it('paints no background while loading', () => {
      mockGetActiveOfflineSession.mockReturnValue(new Promise(() => {}))

      render(<OfflineAppShell />)

      expectNoBackground(
        screen.getByRole('status', { name: 'Loading offline timeline' })
      )
    })

    it('paints no background when ready', async () => {
      mockGetActiveOfflineSession.mockResolvedValueOnce({
        actorId: 'actor-1',
        accountId: 'account-1'
      })
      mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
      mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
      mockGetAccountBootstrap.mockResolvedValueOnce(null)

      render(<OfflineAppShell />)

      const timeline = await screen.findByTestId('main-timeline')
      expectNoBackground(timeline.closest('.overflow-y-auto'))
    })

    it('paints no background when the cache is empty and offline', async () => {
      mockGetActiveOfflineSession.mockResolvedValueOnce(null)
      mockGetAccountBootstrap.mockRejectedValueOnce(new Error('Network error'))

      render(<OfflineAppShell />)

      const text = await screen.findByText('You are offline')
      expectNoBackground(text.closest('.overflow-y-auto'))
    })

    it('paints no background when the cache is empty and unauthorized', async () => {
      mockGetActiveOfflineSession.mockResolvedValueOnce(null)
      mockGetAccountBootstrap.mockRejectedValueOnce(
        new TimelineRequestError('Unauthorized', 401)
      )

      render(<OfflineAppShell />)

      const text = await screen.findByText('Not signed in')
      expectNoBackground(text.closest('.overflow-y-auto'))
    })
  })

  it('synchronizes container scroll event with window.scrollY and window scroll event', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce({
      actorId: 'actor-1',
      accountId: 'account-1'
    })
    mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
    mockGetAccountBootstrap.mockResolvedValueOnce(null)

    const windowScrollListener = vi.fn()
    window.addEventListener('scroll', windowScrollListener)

    const { container } = render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
    })

    const scrollContainer = container.querySelector('.fixed.inset-0')!
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 350 })
    fireEvent.scroll(scrollContainer)

    expect(windowScrollListener).toHaveBeenCalled()
    expect(window.scrollY).toBe(350)

    window.removeEventListener('scroll', windowScrollListener)
  })

  it('proxies window.scrollTo and window.scrollBy to shell container and restores originals on unmount', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce({
      actorId: 'actor-1',
      accountId: 'account-1'
    })
    mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
    mockGetAccountBootstrap.mockResolvedValueOnce(null)

    const originalScrollTo = window.scrollTo
    const originalScrollBy = window.scrollBy

    const { unmount, container } = render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
    })

    const scrollContainer = container.querySelector(
      '.fixed.inset-0.overflow-y-auto'
    ) as HTMLDivElement
    expect(scrollContainer).toBeInTheDocument()

    // Test scrollTo
    window.scrollTo({ top: 400, behavior: 'instant' })
    expect(scrollContainer.scrollTop).toBe(400)
    expect(window.scrollY).toBe(400)

    // Test scrollBy
    window.scrollBy({ top: 50, behavior: 'instant' })
    expect(scrollContainer.scrollTop).toBe(450)
    expect(window.scrollY).toBe(450)

    // Test unmount restores originals and cleans up window scroll properties
    unmount()
    expect(window.scrollTo).toBe(originalScrollTo)
    expect(window.scrollBy).toBe(originalScrollBy)
    expect(Object.prototype.hasOwnProperty.call(window, 'scrollY')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(window, 'scrollX')).toBe(false)
  })

  describe('views by path', () => {
    const renderReady = async () => {
      mockGetActiveOfflineSession.mockResolvedValueOnce({
        actorId: 'actor-1',
        accountId: 'account-1'
      })
      mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
      mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
      mockGetAccountBootstrap.mockResolvedValueOnce(null)
      render(<OfflineAppShell />)
      await screen.findByTestId('desktop-sidebar')
    }

    it('renders the drafts list with bootstrap props on /drafts', async () => {
      mockPathname = '/drafts'
      await renderReady()

      expect(
        screen.getAllByRole('heading', { name: 'Drafts' }).length
      ).toBeGreaterThan(0)
      expect(screen.getByTestId('drafts-list')).toHaveTextContent(
        `llun.social|alice|${dummyBootstrap.currentTime}|true`
      )
      expect(screen.queryByTestId('main-timeline')).not.toBeInTheDocument()
    })

    it('renders Not saved for offline with an Open drafts link on any other path', async () => {
      mockPathname = '/notifications'
      await renderReady()

      expect(
        screen.getByRole('heading', { name: 'Not saved for offline' })
      ).toBeVisible()
      expect(screen.getByRole('link', { name: 'Open drafts' })).toHaveAttribute(
        'href',
        '/drafts'
      )
      expect(screen.queryByTestId('main-timeline')).not.toBeInTheDocument()
      expect(screen.queryByTestId('drafts-list')).not.toBeInTheDocument()
    })

    it.each(['/', '/app'])('renders the timeline on %s', async (path) => {
      mockPathname = path
      await renderReady()

      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
      expect(mockOnConnectionRestored).not.toHaveBeenCalled()
    })

    it('reloads when the connection returns on a non-timeline view and stops listening on unmount', async () => {
      mockPathname = '/drafts'
      const reload = vi.fn()
      const original = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...original, reload }
      })
      try {
        mockGetActiveOfflineSession.mockResolvedValueOnce({
          actorId: 'actor-1',
          accountId: 'account-1'
        })
        mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
        mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
        mockGetAccountBootstrap.mockResolvedValueOnce(null)
        const { unmount } = render(<OfflineAppShell />)
        await screen.findByTestId('drafts-list')

        expect(mockOnConnectionRestored).toHaveBeenCalledTimes(1)
        mockOnConnectionRestored.mock.calls[0][0]()
        expect(reload).toHaveBeenCalledTimes(1)

        unmount()
        expect(mockUnsubscribe).toHaveBeenCalled()
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: original
        })
      }
    })
  })

  it('does not render duplicate Modal in shell', async () => {
    mockGetActiveOfflineSession.mockResolvedValueOnce({
      actorId: 'actor-1',
      accountId: 'account-1'
    })
    mockGetClientBootstrapSnapshot.mockResolvedValueOnce(dummyBootstrap)
    mockGetOfflineTimeline.mockResolvedValueOnce(dummyTimeline)
    mockGetAccountBootstrap.mockResolvedValueOnce(null)

    render(<OfflineAppShell />)

    await waitFor(() => {
      expect(screen.getByTestId('main-timeline')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
  })
})

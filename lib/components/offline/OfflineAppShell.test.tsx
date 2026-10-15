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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TimelineRequestError } from '@/lib/client/timelines'
import { OfflineAppShell } from '@/lib/components/offline/OfflineAppShell'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/app'
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

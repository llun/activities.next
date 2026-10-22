'use client'

import { CloudOff, UserX, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import { TimelineLoading } from '@/app/(timeline)/(home)/loading'
import { MainPageTimeline } from '@/app/(timeline)/MainPageTimeline'
import {
  PendingProfileNavigationProvider,
  PendingProfileOverlay
} from '@/app/(timeline)/PendingProfileNavigation'
import { DraftsPage } from '@/app/(timeline)/drafts/DraftsPage'
import { getAccountBootstrap } from '@/lib/client/bootstrap'
import {
  getConnectionSnapshot,
  onConnectionRestored,
  probeNow
} from '@/lib/client/connection'
import {
  type ClientBootstrapSnapshot,
  type HydratedOfflineTimeline,
  getActiveOfflineSession,
  getClientBootstrapSnapshot,
  getOfflineTimeline,
  saveClientBootstrapSnapshot
} from '@/lib/client/offline'
import { TimelineRequestError } from '@/lib/client/timelines'
import {
  ConnectionAnnouncer,
  ConnectionStatusBar
} from '@/lib/components/connection/ConnectionStatus'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'
import { Sidebar } from '@/lib/components/layout/sidebar'
import { PageHeader } from '@/lib/components/page-header'
import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { SessionKeepAlive } from '@/lib/components/session-keep-alive'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

type ShellState =
  | { status: 'loading' }
  | {
      status: 'ready'
      bootstrap: ClientBootstrapSnapshot
      timeline: HydratedOfflineTimeline | null
    }
  | { status: 'empty-cache-offline' }
  | { status: 'empty-cache-unauthorized' }

type ShellView = 'timeline' | 'drafts' | 'unavailable'

const SHELL_RELOAD_KEY = 'activities-shell-reloaded-at'
const SHELL_RELOAD_GAP_MS = 30_000

/**
 * Reloads into the real page, at most once in SHELL_RELOAD_GAP_MS: a page whose
 * own fetch still fails while /health answers would otherwise bounce back to
 * the shell and reload forever. False when it held back.
 */
const reloadOnce = (): boolean => {
  try {
    const last = Number(sessionStorage.getItem(SHELL_RELOAD_KEY) ?? 0)
    if (Date.now() - last < SHELL_RELOAD_GAP_MS) return false
    sessionStorage.setItem(SHELL_RELOAD_KEY, String(Date.now()))
  } catch {
    // Storage blocked: reload anyway, the restore listener is the backstop.
  }
  window.location.reload()
  return true
}

const getShellView = (pathname: string | null): ShellView => {
  if (pathname === '/' || pathname === '/app') return 'timeline'
  // The worker serves this shell for both forms when offline.
  if (pathname === '/drafts' || pathname === '/drafts/') return 'drafts'
  return 'unavailable'
}

export function OfflineAppShell() {
  const router = useRouter()
  const view = getShellView(usePathname())
  // The Drafts page measures "Queued … ago" against now: posts queued offline
  // are newer than the cached bootstrap's server time.
  const [openedAt] = useState(() => Date.now())
  const [staysOnline, setStaysOnline] = useState(false)
  const [shellState, setShellState] = useState<ShellState>({
    status: 'loading'
  })

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const session = await getActiveOfflineSession()
        if (session?.actorId) {
          const cachedBootstrap = await getClientBootstrapSnapshot(
            session.actorId
          )
          if (cachedBootstrap) {
            const cachedTimeline = await getOfflineTimeline({
              actorId: session.actorId,
              timeline: 'home',
              filterKey: 'all'
            })

            if (!mounted) return
            setShellState({
              status: 'ready',
              bootstrap: cachedBootstrap,
              timeline: cachedTimeline
            })

            void (async () => {
              try {
                const fresh =
                  await getAccountBootstrap<ClientBootstrapSnapshot>()
                if (fresh && mounted) {
                  await saveClientBootstrapSnapshot(fresh)
                  setShellState((prev) =>
                    prev.status === 'ready'
                      ? { ...prev, bootstrap: fresh }
                      : prev
                  )
                }
              } catch {
                // Background refresh error ignored
              }
            })()
            return
          }
        }
      } catch {
        // Fall through to network attempt
      }

      try {
        const fresh = await getAccountBootstrap<ClientBootstrapSnapshot>()
        if (!mounted) return
        if (fresh) {
          await saveClientBootstrapSnapshot(fresh)
          const cachedTimeline = await getOfflineTimeline({
            actorId: fresh.actorId,
            timeline: 'home',
            filterKey: 'all'
          })
          if (!mounted) return
          setShellState({
            status: 'ready',
            bootstrap: fresh,
            timeline: cachedTimeline
          })
          return
        }
      } catch (error) {
        if (!mounted) return
        if (
          error instanceof TimelineRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          setShellState({ status: 'empty-cache-unauthorized' })
          return
        }
      }

      if (mounted) {
        setShellState({ status: 'empty-cache-offline' })
      }
    }

    void init()

    return () => {
      mounted = false
    }
  }, [])

  // The shell stands in for a route it cannot draw: once back online, load the
  // real page over it. The store starts out online, so a navigation that failed
  // while it still says so would never see a restore: probe once on mount.
  useEffect(() => {
    if (view === 'timeline') return
    const stop = onConnectionRestored(() => window.location.reload())
    void probeNow().then(() => {
      // Online but held back from reloading: nothing will cut a send off now,
      // so the queue sends from here.
      if (getConnectionSnapshot().state === 'online' && !reloadOnce()) {
        setStaysOnline(true)
      }
    })
    return stop
  }, [view])

  const handleUnauthorized = useCallback(() => {
    router.push('/auth/signin')
  }, [router])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return

    const originalScrollTo = window.scrollTo
    const originalScrollBy = window.scrollBy

    window.scrollTo = ((...args: unknown[]) => {
      const container = scrollContainerRef.current
      if (container) {
        if (typeof args[0] === 'object' && args[0] !== null) {
          const opts = args[0] as ScrollToOptions
          const top =
            typeof opts.top === 'number' ? opts.top : container.scrollTop
          const left =
            typeof opts.left === 'number' ? opts.left : container.scrollLeft
          if (typeof container.scrollTo === 'function') {
            container.scrollTo(opts)
          } else {
            container.scrollTop = top
            container.scrollLeft = left
          }
        } else {
          const left =
            typeof args[0] === 'number' ? args[0] : container.scrollLeft
          const top =
            typeof args[1] === 'number' ? args[1] : container.scrollTop
          if (typeof container.scrollTo === 'function') {
            container.scrollTo(left, top)
          } else {
            container.scrollLeft = left
            container.scrollTop = top
          }
        }
        try {
          Object.defineProperty(window, 'scrollY', {
            value: container.scrollTop,
            configurable: true
          })
          Object.defineProperty(window, 'scrollX', {
            value: container.scrollLeft,
            configurable: true
          })
          window.dispatchEvent(new Event('scroll'))
        } catch {
          // safe ignore
        }
      } else {
        originalScrollTo.apply(window, args as [number, number])
      }
    }) as typeof window.scrollTo

    window.scrollBy = ((...args: unknown[]) => {
      const container = scrollContainerRef.current
      if (container) {
        if (typeof args[0] === 'object' && args[0] !== null) {
          const opts = args[0] as ScrollToOptions
          const topDelta = typeof opts.top === 'number' ? opts.top : 0
          const leftDelta = typeof opts.left === 'number' ? opts.left : 0
          if (typeof container.scrollBy === 'function') {
            container.scrollBy(opts)
          } else {
            container.scrollTop += topDelta
            container.scrollLeft += leftDelta
          }
        } else {
          const leftDelta = typeof args[0] === 'number' ? args[0] : 0
          const topDelta = typeof args[1] === 'number' ? args[1] : 0
          if (typeof container.scrollBy === 'function') {
            container.scrollBy(leftDelta, topDelta)
          } else {
            container.scrollLeft += leftDelta
            container.scrollTop += topDelta
          }
        }
        try {
          Object.defineProperty(window, 'scrollY', {
            value: container.scrollTop,
            configurable: true
          })
          Object.defineProperty(window, 'scrollX', {
            value: container.scrollLeft,
            configurable: true
          })
          window.dispatchEvent(new Event('scroll'))
        } catch {
          // safe ignore
        }
      } else {
        originalScrollBy.apply(window, args as [number, number])
      }
    }) as typeof window.scrollBy

    return () => {
      window.scrollTo = originalScrollTo
      window.scrollBy = originalScrollBy
      try {
        delete (window as unknown as { scrollY?: number }).scrollY
        delete (window as unknown as { scrollX?: number }).scrollX
      } catch {
        // safe ignore
      }
    }
  }, [])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    try {
      Object.defineProperty(window, 'scrollY', {
        value: event.currentTarget.scrollTop,
        configurable: true
      })
      window.dispatchEvent(new Event('scroll'))
    } catch {
      // safe ignore
    }
  }

  // None of the full-screen wrappers below paints a background, so the body
  // backdrop (app/globals.css) shows through; the signed-in ones carry
  // `main[data-app-shell]` so the glows sit below the top bar, as on the
  // server layout.
  if (shellState.status === 'loading') {
    return (
      <div
        ref={scrollContainerRef}
        role="status"
        aria-label="Loading offline timeline"
        className="fixed inset-0 z-20 min-h-dvh overflow-y-auto safe-area-px"
        onScroll={handleScroll}
      >
        <NavPreferencesProvider>
          <MobileNavigationProvider>
            <PendingProfileNavigationProvider>
              <div className="min-h-dvh">
                <Sidebar isLoading />
                <MobileNav />
                <main
                  data-app-shell=""
                  className={cn(
                    'flex min-h-dvh flex-col overflow-x-clip pb-6',
                    'md:pl-[72px] md:[--sidebar-w:72px] xl:pl-[280px] xl:[--sidebar-w:280px]'
                  )}
                >
                  <div className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 pb-6">
                    <TimelineLoading />
                  </div>
                </main>
              </div>
            </PendingProfileNavigationProvider>
          </MobileNavigationProvider>
        </NavPreferencesProvider>
      </div>
    )
  }

  if (shellState.status === 'empty-cache-offline') {
    return (
      <div className="fixed inset-0 z-20 min-h-dvh overflow-y-auto flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-md">
          <EmptyState icon={WifiOff} title="You are offline">
            No cached timeline found for this device. Please connect to the
            internet to load your timeline.
          </EmptyState>
        </div>
      </div>
    )
  }

  if (shellState.status === 'empty-cache-unauthorized') {
    return (
      <div className="fixed inset-0 z-20 min-h-dvh overflow-y-auto flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-md">
          <EmptyState
            icon={UserX}
            title="Not signed in"
            action={
              <Button asChild size="sm">
                <Link href="/auth/signin">Sign in</Link>
              </Button>
            }
          >
            Please sign in to view your timeline.
          </EmptyState>
        </div>
      </div>
    )
  }

  const { bootstrap, timeline } = shellState

  const user = {
    name: bootstrap.user.name || bootstrap.user.username,
    username: bootstrap.user.username,
    handle: bootstrap.user.handle,
    avatarUrl: isRealAvatar(bootstrap.user.avatarUrl)
      ? (bootstrap.user.avatarUrl ?? undefined)
      : undefined
  }

  const currentActor = {
    id: bootstrap.currentActor.id,
    username: bootstrap.currentActor.username,
    domain: bootstrap.currentActor.domain,
    name: bootstrap.currentActor.name,
    iconUrl: isRealAvatar(bootstrap.currentActor.iconUrl)
      ? bootstrap.currentActor.iconUrl
      : null
  }

  const formattedActors = (bootstrap.actors || []).map((a) => ({
    id: a.id,
    username: a.username,
    domain: a.domain,
    name: a.name,
    iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null,
    deletionStatus: a.deletionStatus ?? null,
    deletionScheduledAt: a.deletionScheduledAt ?? null
  }))

  const formattedLists = (bootstrap.lists || []).map((l) => ({
    id: l.id,
    title: l.title
  }))

  return (
    <div
      ref={scrollContainerRef}
      className="fixed inset-0 z-20 min-h-dvh overflow-y-auto safe-area-px"
      onScroll={handleScroll}
    >
      <InstanceLimitsProvider {...bootstrap.instanceLimits}>
        <PlaybackPreferencesProvider
          actorId={bootstrap.actorId}
          initialAutoplayGifs={bootstrap.readingAutoplayGifs ?? false}
        >
          <NavPreferencesProvider
            initialOrder={bootstrap.navOrder}
            initialHidden={bootstrap.navHidden}
          >
            <MobileNavigationProvider>
              <PendingProfileNavigationProvider>
                <DraftsProvider
                  accountId={bootstrap.accountId}
                  actorId={bootstrap.actorId}
                  // The other views reload into the real page once back
                  // online (above); that page sends.
                  sends={view === 'timeline' || staysOnline}
                >
                  <div className="min-h-dvh">
                    <Sidebar
                      user={user}
                      currentActor={currentActor}
                      actors={formattedActors}
                      unreadCount={bootstrap.unreadCount}
                      fitnessUrl={bootstrap.fitnessUrl}
                      galleryUrl={bootstrap.galleryUrl}
                      isAdmin={bootstrap.isAdmin}
                      lists={formattedLists}
                      features={bootstrap.features}
                    />
                    <MobileNav
                      user={user}
                      currentActor={currentActor}
                      actors={formattedActors}
                      unreadCount={bootstrap.unreadCount}
                      fitnessUrl={bootstrap.fitnessUrl}
                      galleryUrl={bootstrap.galleryUrl}
                      isAdmin={bootstrap.isAdmin}
                      lists={formattedLists}
                      features={bootstrap.features}
                    />
                    <main
                      data-app-shell=""
                      className={cn(
                        'flex min-h-dvh flex-col overflow-x-clip pb-6',
                        'md:pl-[72px] md:[--sidebar-w:72px] xl:pl-[280px] xl:[--sidebar-w:280px]'
                      )}
                    >
                      <div className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 pb-6">
                        <ConnectionStatusBar />
                        {view === 'timeline' && (
                          <MainPageTimeline
                            host={bootstrap.host}
                            currentTime={
                              bootstrap.currentTime || bootstrap.savedAt
                            }
                            statuses={timeline?.statuses || []}
                            timelineContext={{
                              ancestorsById: timeline?.ancestorsById || {}
                            }}
                            initialNextMaxStatusId={
                              timeline?.nextMaxStatusId ?? null
                            }
                            profile={bootstrap.profile}
                            isMediaUploadEnabled={
                              bootstrap.isMediaUploadEnabled
                            }
                            initialSegments={timeline?.segments}
                            initialScrollAnchor={timeline?.scrollAnchor}
                            initialLastRefreshedAt={timeline?.lastRefreshedAt}
                            refreshOnMount={true}
                            readingGroupBoosts={bootstrap.readingGroupBoosts}
                            postLineLimit={bootstrap.postLineLimit}
                            onUnauthorized={handleUnauthorized}
                          />
                        )}
                        {view === 'drafts' && (
                          <DraftsPage
                            host={bootstrap.host}
                            profile={bootstrap.profile}
                            currentTime={openedAt}
                            isMediaUploadEnabled={
                              bootstrap.isMediaUploadEnabled
                            }
                          />
                        )}
                        {view === 'unavailable' && (
                          <div className="space-y-6">
                            <PageHeader title="Offline" />
                            <EmptyState
                              icon={CloudOff}
                              titleAs="h2"
                              title="Not saved for offline"
                              action={
                                <Button asChild size="sm">
                                  <Link href="/drafts">Open drafts</Link>
                                </Button>
                              }
                            >
                              This page wasn&apos;t saved on this device.
                              Connect to the internet to open it.
                            </EmptyState>
                          </div>
                        )}
                      </div>
                      <PendingProfileOverlay variant="signed-in" />
                    </main>
                    <SessionKeepAlive />
                    <ConnectionAnnouncer />
                  </div>
                </DraftsProvider>
              </PendingProfileNavigationProvider>
            </MobileNavigationProvider>
          </NavPreferencesProvider>
        </PlaybackPreferencesProvider>
      </InstanceLimitsProvider>
    </div>
  )
}

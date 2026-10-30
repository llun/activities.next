'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'

import { ProfileLoading } from '@/app/(timeline)/[actor]/(profile)/loading'
import { StatusLoadingSkeleton } from '@/app/(timeline)/[actor]/[status]/StatusLoadingSkeleton'
import { OpenStatusPathContext } from '@/lib/components/posts/useOpenStatusPath'
import { cn } from '@/lib/utils'

import {
  getProfileNavigationTarget,
  isSameTabNavigationClick
} from './profileNavigationTarget'

// If the router never commits (a navigation that was cancelled or failed
// without changing the URL), stop covering the page that is still there.
export const PENDING_NAVIGATION_TIMEOUT_MS = 15_000

// A post opens fast enough (about 250 ms in production) that painting a
// skeleton for it would only flash; only a slow open (for example a remote
// post that is not stored yet, fetched before the page can render) gets one.
export const PENDING_STATUS_DELAY_MS = 500

interface PendingNavigation {
  href: string
  fromPathname: string | null
}

// `null` while nothing is pending or the delay has not elapsed.
const VisibleStatusNavigationContext = createContext<PendingNavigation | null>(
  null
)

const PendingProfileNavigationContext = createContext<PendingNavigation | null>(
  null
)

/**
 * Shows the profile skeleton the moment a profile link is clicked.
 *
 * Profile links do not prefetch (see "Link prefetching in feeds" in
 * docs/architecture.md), so the router has nothing to render until the server
 * answers, and the old page sat unchanged for that whole round trip. This
 * watches clicks on same-tab links to `/@user@domain` and reports the pending
 * profile until the pathname changes, when the route's own `loading.tsx` (the
 * same skeleton) or the page takes over.
 */
export const PendingProfileNavigationProvider: FC<{ children: ReactNode }> = ({
  children
}) => {
  const pathname = usePathname()
  const router = useRouter()
  const [pending, setPending] = useState<PendingNavigation | null>(null)
  const [pendingStatus, setPendingStatus] = useState<PendingNavigation | null>(
    null
  )
  // The pending status navigation whose delay has elapsed (compared by
  // identity, so a newer navigation starts hidden again).
  const [shownStatus, setShownStatus] = useState<PendingNavigation | null>(null)

  // The navigation committed (or the visitor went elsewhere): drop the
  // pending state during render so the destination never paints under it.
  if (pending && pending.fromPathname !== pathname) {
    setPending(null)
  }
  if (pendingStatus && pendingStatus.fromPathname !== pathname) {
    setPendingStatus(null)
  }

  // Read through a ref so `openStatusPath` stays stable across navigations
  // (memoized rows depend on it).
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  const openStatusPath = useCallback(
    (path: string) => {
      const current = pathnameRef.current
      if (path.split(/[?#]/)[0] !== current) {
        setPendingStatus({ href: path, fromPathname: current })
      }
      router.push(path)
    },
    [router]
  )

  useEffect(() => {
    // Capture phase: some profile links stop propagation of their click.
    const onClick = (event: MouseEvent) => {
      const href = getProfileNavigationTarget(event, window.location)
      if (href) {
        setPending({ href, fromPathname: pathname })
        setPendingStatus(null)
      } else if (isSameTabNavigationClick(event)) {
        // Another same-tab link replaces whatever was pending. If it keeps
        // the pathname, the render-phase clear would never fire and the
        // skeleton would cover the page until the safety timeout.
        setPending(null)
        setPendingStatus(null)
      }
    }
    // A plain `<a>` reloads the document; coming back to it from the
    // back/forward cache must not restore the skeleton.
    const onPageShow = () => {
      setPending(null)
      setPendingStatus(null)
    }
    // Back/forward replaces the pending navigation too.
    const onPopState = () => {
      setPending(null)
      setPendingStatus(null)
    }
    window.addEventListener('click', onClick, true)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('popstate', onPopState)
    }
  }, [pathname])

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(
      () => setPending(null),
      PENDING_NAVIGATION_TIMEOUT_MS
    )
    return () => clearTimeout(timer)
  }, [pending])

  useEffect(() => {
    if (!pendingStatus) return
    const showTimer = setTimeout(
      () => setShownStatus(pendingStatus),
      PENDING_STATUS_DELAY_MS
    )
    const clearTimer = setTimeout(
      () => setPendingStatus(null),
      PENDING_NAVIGATION_TIMEOUT_MS
    )
    return () => {
      clearTimeout(showTimer)
      clearTimeout(clearTimer)
    }
  }, [pendingStatus])

  return (
    <PendingProfileNavigationContext.Provider value={pending}>
      <VisibleStatusNavigationContext.Provider
        value={shownStatus === pendingStatus ? shownStatus : null}
      >
        <OpenStatusPathContext.Provider value={openStatusPath}>
          {children}
        </OpenStatusPathContext.Provider>
      </VisibleStatusNavigationContext.Provider>
    </PendingProfileNavigationContext.Provider>
  )
}

export const usePendingProfileNavigation = () =>
  useContext(PendingProfileNavigationContext)

const OVERLAY_CLASS = {
  // Covers the `(timeline)` layout's content column, beside the sidebar
  // (72px rail from `md`, 280px from `xl`) and under it, the mobile drawer and
  // modals, but over the pages' sticky headers. Both variants pad by the
  // left and right safe areas like the body, and the rail grows by the left
  // one, so the skeleton lines up with the page it stands in for.
  'signed-in':
    'inset-y-0 right-0 left-0 z-35 pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)] md:left-[calc(72px+env(safe-area-inset-left,0px))] md:pl-0 xl:left-[calc(280px+env(safe-area-inset-left,0px))]',
  // Below `PublicShell`'s sticky top bar (h-16 plus its bottom border).
  public: 'inset-x-0 bottom-0 top-[calc(4rem+1px)] z-20 safe-area-px'
} as const

const COLUMN_CLASS = {
  // Mirrors the `(timeline)` layout's content wrapper.
  'signed-in': 'mx-auto flex w-full max-w-content flex-col px-4 pb-6',
  // Mirrors `PublicShell`'s reading column.
  public:
    'mx-auto flex w-full max-w-[680px] flex-col px-4 py-6 max-md:max-w-none'
} as const

interface PendingProfileOverlayProps {
  variant: keyof typeof OVERLAY_CLASS
}

/**
 * The skeleton laid over the current page while a navigation is pending: the
 * profile's at once, a post's only after `PENDING_STATUS_DELAY_MS`. An overlay
 * rather than a swap: the page underneath keeps its height and scroll
 * position, which the browser records for Back when the navigation commits.
 */
export const PendingProfileOverlay: FC<PendingProfileOverlayProps> = ({
  variant
}) => {
  const pending = usePendingProfileNavigation()
  const pendingStatus = useContext(VisibleStatusNavigationContext)

  let testId: string
  let skeleton: ReactNode
  if (pending) {
    testId = 'pending-profile-overlay'
    skeleton = <ProfileLoading />
  } else if (pendingStatus) {
    testId = 'pending-status-overlay'
    skeleton = <StatusLoadingSkeleton />
  } else {
    return null
  }

  return (
    <div
      data-testid={testId}
      className={cn(
        'app-backdrop fixed overflow-hidden',
        OVERLAY_CLASS[variant]
      )}
    >
      <div className={COLUMN_CLASS[variant]}>{skeleton}</div>
    </div>
  )
}

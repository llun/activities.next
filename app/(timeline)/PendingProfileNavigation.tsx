'use client'

import { usePathname } from 'next/navigation'
import {
  FC,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState
} from 'react'

import { ProfileLoading } from '@/app/(timeline)/[actor]/loading'
import { cn } from '@/lib/utils'

import { getProfileNavigationTarget } from './profileNavigationTarget'

// If the router never commits (a navigation that was cancelled or failed
// without changing the URL), stop covering the page that is still there.
export const PENDING_PROFILE_TIMEOUT_MS = 15_000

interface PendingNavigation {
  href: string
  fromPathname: string | null
}

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
  const [pending, setPending] = useState<PendingNavigation | null>(null)

  // The navigation committed (or the visitor went elsewhere): drop the
  // pending state during render so the destination never paints under it.
  if (pending && pending.fromPathname !== pathname) {
    setPending(null)
  }

  useEffect(() => {
    // Capture phase: some profile links stop propagation of their click.
    const onClick = (event: MouseEvent) => {
      const href = getProfileNavigationTarget(event, window.location)
      if (href) setPending({ href, fromPathname: pathname })
    }
    // A plain `<a>` reloads the document; coming back to it from the
    // back/forward cache must not restore the skeleton.
    const onPageShow = () => setPending(null)
    window.addEventListener('click', onClick, true)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [pathname])

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setPending(null), PENDING_PROFILE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pending])

  return (
    <PendingProfileNavigationContext.Provider value={pending}>
      {children}
    </PendingProfileNavigationContext.Provider>
  )
}

export const usePendingProfileNavigation = () =>
  useContext(PendingProfileNavigationContext)

const OVERLAY_CLASS = {
  // Covers the `(timeline)` layout's content column, beside the sidebar
  // (72px rail from `md`, 280px from `xl`) and under it, the mobile drawer and
  // modals, but over the pages' sticky headers.
  'signed-in': 'inset-y-0 right-0 left-0 z-35 md:left-[72px] xl:left-[280px]',
  // Below `PublicShell`'s sticky top bar (h-16 plus its bottom border).
  public: 'inset-x-0 bottom-0 top-[calc(4rem+1px)] z-20'
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
 * The profile skeleton laid over the current page while a profile navigation
 * is pending. An overlay rather than a swap: the page underneath keeps its
 * height and scroll position, which the browser records for Back when the
 * navigation commits.
 */
export const PendingProfileOverlay: FC<PendingProfileOverlayProps> = ({
  variant
}) => {
  const pending = usePendingProfileNavigation()
  if (!pending) return null

  return (
    <div
      data-testid="pending-profile-overlay"
      className={cn(
        'app-backdrop fixed overflow-hidden',
        OVERLAY_CLASS[variant]
      )}
    >
      <div className={COLUMN_CLASS[variant]}>
        <ProfileLoading />
      </div>
    </div>
  )
}

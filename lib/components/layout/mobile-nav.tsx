'use client'

import { MoreHorizontal, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'

import { type NavItem, buildNavLayout } from '@/lib/components/layout/nav-items'
import { useNavPreferences } from '@/lib/components/layout/nav-preferences-context'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { type NavFeatureFlags } from '@/lib/services/navigation/navPreferences'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  unreadCount?: number
  fitnessUrl?: string
  profileUrl?: string
  isAdmin?: boolean
  features?: Partial<NavFeatureFlags>
}

// Profile has no registry entry: its href is per-user and it exists only on
// this surface, where the sidebar's account switcher has no room.
type MobileNavEntry = Pick<
  NavItem,
  'href' | 'label' | 'shortLabel' | 'icon'
> & {
  key: string
  isNotifications?: boolean
}

const toEntry = (item: NavItem): MobileNavEntry => ({
  key: item.id,
  href: item.href,
  label: item.label,
  shortLabel: item.shortLabel,
  icon: item.icon,
  isNotifications: item.id === 'notifications'
})

export function MobileNav({
  unreadCount = 0,
  fitnessUrl,
  profileUrl,
  isAdmin = false,
  features
}: MobileNavProps) {
  const pathname = usePathname()
  const { order, hidden } = useNavPreferences()
  const { shown, more } = useMemo(
    () =>
      buildNavLayout({
        fitnessUrl,
        isAdmin,
        features,
        prefs: { navOrder: order, navHidden: hidden }
      }),
    [features, fitnessUrl, hidden, isAdmin, order]
  )

  // The bar takes the first four items the user chose to show; everything else
  // moves into the More sheet.
  const directNavItems = shown.slice(0, 4).map(toEntry)
  const overflowNavItems = shown.slice(4).map(toEntry)

  if (profileUrl) {
    // Match the design system's overflow order: Profile leads the account-level
    // cluster, just before the first of Admin/Account/Settings. The registry
    // keeps these in the order Admin → Account → Settings, so the first match
    // resolves to Admin when present, then Account, then Settings.
    const accountIndex = overflowNavItems.findIndex(
      (item) =>
        item.key === 'admin' ||
        item.key === 'account' ||
        item.key === 'settings'
    )
    overflowNavItems.splice(
      accountIndex >= 0 ? accountIndex : overflowNavItems.length,
      0,
      { key: 'profile', href: profileUrl, label: 'Profile', icon: User }
    )
  }

  const hiddenNavItems = more.map(toEntry)

  const isItemActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')
  const isOverflowActive = [...overflowNavItems, ...hiddenNavItems].some(
    (item) => isItemActive(item.href)
  )
  // Notifications only keeps its badge while it holds a slot in the bar, so the
  // unread count rides along with the More tab whenever it doesn't.
  const showOverflowBadge =
    unreadCount > 0 && !directNavItems.some((item) => item.isNotifications)

  const renderMenuItem = (item: MobileNavEntry, muted = false) => {
    const isActive = isItemActive(item.href)
    // Every entry here is a bounded, fixed registry route except the
    // synthesized Profile item, whose href is the viewer's own per-user
    // `/@user@domain` — a fully dynamic route that triggers a WebFinger and
    // signed actor fetch for a remote actor (see "Link prefetching in feeds"
    // in AGENTS.md). Only that one item opts out; the rest are cheap to
    // prefetch like any other nav chrome.
    const isProfileItem = item.key === 'profile'
    return (
      <DropdownMenuItem key={item.key} asChild>
        <Link
          href={item.href}
          prefetch={isProfileItem ? false : undefined}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2',
            isActive && 'text-primary',
            muted && !isActive && 'text-muted-foreground'
          )}
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/90 backdrop-blur md:hidden safe-area-pb">
      <ul className="grid grid-flow-col auto-cols-fr items-center py-2">
        {directNavItems.map((item) => {
          const isActive = isItemActive(item.href)
          return (
            <li key={item.key} className="min-w-0">
              {/* The Profile entry never reaches the direct bar — it is
                  spliced only into overflowNavItems — so every link here is
                  a bounded registry route and keeps default prefetching. */}
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <div className="relative">
                  <item.icon className="h-6 w-6" />
                  {item.isNotifications && unreadCount > 0 && (
                    <NotificationBadge
                      count={unreadCount}
                      className="absolute -top-1 -right-1"
                    />
                  )}
                </div>
                <span className="max-w-full truncate">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            </li>
          )
        })}
        {overflowNavItems.length + hiddenNavItems.length > 0 && (
          <li className="min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'relative flex min-h-14 w-full min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors',
                    isOverflowActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                  aria-label="More navigation"
                >
                  <div className="relative">
                    <MoreHorizontal className="h-6 w-6" />
                    {showOverflowBadge && (
                      <NotificationBadge
                        count={unreadCount}
                        className="absolute -top-1 -right-1"
                      />
                    )}
                  </div>
                  <span className="max-w-full truncate">More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" sideOffset={8}>
                {overflowNavItems.map((item) => renderMenuItem(item))}
                {/* Hidden items are still reachable here — hiding tidies the
                    navigation, it doesn't lock a section away. */}
                {hiddenNavItems.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                      Hidden
                    </DropdownMenuLabel>
                    {hiddenNavItems.map((item) => renderMenuItem(item, true))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )}
      </ul>
    </nav>
  )
}

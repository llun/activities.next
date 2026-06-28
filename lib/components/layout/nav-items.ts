import {
  Activity,
  Bell,
  Bookmark,
  Compass,
  Heart,
  Home,
  List,
  Mail,
  Search,
  Settings,
  Shield,
  Users
} from 'lucide-react'
import { type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  // Compact label used by space-constrained surfaces (the mobile bottom bar).
  // Falls back to `label` when omitted.
  shortLabel?: string
  icon: LucideIcon
}

const baseNavItems: NavItem[] = [
  { href: '/', label: 'Timeline', shortLabel: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/messages', label: 'Messages', icon: Mail },
  { href: '/favorites', label: 'Favorites', icon: Heart },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { href: '/lists', label: 'Lists', icon: List },
  {
    href: '/notifications',
    label: 'Notifications',
    shortLabel: 'Alerts',
    icon: Bell
  },
  { href: '/account', label: 'Account', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings }
]

interface BuildNavItemsParams {
  fitnessUrl?: string
  isAdmin?: boolean
}

export function buildNavItems({
  fitnessUrl,
  isAdmin = false
}: BuildNavItemsParams): NavItem[] {
  const items = [...baseNavItems]

  if (fitnessUrl) {
    const notificationsIndex = items.findIndex(
      (item) => item.href === '/notifications'
    )
    items.splice(
      notificationsIndex >= 0 ? notificationsIndex : items.length,
      0,
      { href: fitnessUrl, label: 'Fitness', icon: Activity }
    )
  }

  if (isAdmin) {
    // Admin anchors just before Account in the account-level cluster
    // (…notifications, admin, account, settings), matching the design's
    // Sidebar order. Fall back to Settings, then the end, if Account is absent.
    const anchorIndex = items.findIndex(
      (item) => item.href === '/account' || item.href === '/settings'
    )
    items.splice(anchorIndex >= 0 ? anchorIndex : items.length, 0, {
      href: '/admin',
      label: 'Admin',
      icon: Shield
    })
  }

  return items
}

import {
  Activity,
  Bell,
  Bookmark,
  Home,
  List,
  Mail,
  Search,
  Settings,
  Shield,
  Star
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
  { href: '/messages', label: 'Messages', icon: Mail },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { href: '/lists', label: 'Lists', icon: List },
  { href: '/favorites', label: 'Favorites', icon: Star },
  {
    href: '/notifications',
    label: 'Notifications',
    shortLabel: 'Alerts',
    icon: Bell
  },
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
    const settingsIndex = items.findIndex((item) => item.href === '/settings')
    items.splice(settingsIndex >= 0 ? settingsIndex : items.length, 0, {
      href: '/admin',
      label: 'Admin',
      icon: Shield
    })
  }

  return items
}

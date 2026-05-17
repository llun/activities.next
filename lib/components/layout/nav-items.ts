import { Activity, Bell, Bookmark, Home, Settings, Shield } from 'lucide-react'
import { type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

const baseNavItems: NavItem[] = [
  { href: '/', label: 'Timeline', icon: Home },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { href: '/notifications', label: 'Notifications', icon: Bell },
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

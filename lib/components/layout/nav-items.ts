import { Activity, Bell, Home, Settings, Shield } from 'lucide-react'
import { type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

const baseNavItems: NavItem[] = [
  { href: '/', label: 'Timeline', icon: Home },
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
  let items = fitnessUrl
    ? [
        ...baseNavItems.slice(0, 1),
        { href: fitnessUrl, label: 'Fitness', icon: Activity },
        ...baseNavItems.slice(1)
      ]
    : [...baseNavItems]

  if (isAdmin) {
    const settingsIndex = items.findIndex((item) => item.href === '/settings')
    items.splice(settingsIndex, 0, {
      href: '/admin',
      label: 'Admin',
      icon: Shield
    })
  }

  return items
}

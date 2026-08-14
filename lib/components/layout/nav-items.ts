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

import {
  DEFAULT_NAV_ORDER,
  NAV_FEATURE_BY_ID,
  type NavFeatureFlags,
  type NavFeatureKey,
  type NavItemId,
  type NavPreferences,
  isNavItemLocked,
  splitNav
} from '@/lib/services/navigation/navPreferences'

export interface NavItem {
  id: NavItemId
  href: string
  label: string
  // Compact label used by space-constrained surfaces (the mobile bottom bar).
  // Falls back to `label` when omitted.
  shortLabel?: string
  icon: LucideIcon
  // One line explaining the destination, shown by the Settings → Navigation
  // manager under each row.
  blurb: string
  // Pinned items can be reordered but never hidden.
  locked: boolean
  // Set when an instance admin can switch the whole feature off.
  feature?: NavFeatureKey
}

interface NavItemDefinition {
  href: string
  label: string
  shortLabel?: string
  icon: LucideIcon
  blurb: string
}

// The registry: one entry per id, in shipped order. Adding a nav item is one
// entry here plus its id in `NAV_ITEM_IDS` — every surface derives from this.
const NAV_ITEM_DEFINITIONS: Record<NavItemId, NavItemDefinition> = {
  timeline: {
    href: '/',
    label: 'Timeline',
    shortLabel: 'Home',
    icon: Home,
    blurb: 'Posts from accounts you follow'
  },
  search: {
    href: '/search',
    label: 'Search',
    icon: Search,
    blurb: 'Find people and posts'
  },
  explore: {
    href: '/explore',
    label: 'Explore',
    icon: Compass,
    blurb: 'Trends and follow suggestions'
  },
  messages: {
    href: '/messages',
    label: 'Messages',
    icon: Mail,
    blurb: 'Direct conversations'
  },
  favorites: {
    href: '/favorites',
    label: 'Favorites',
    icon: Heart,
    blurb: 'Posts you have favorited'
  },
  bookmarks: {
    href: '/bookmarks',
    label: 'Bookmarks',
    icon: Bookmark,
    blurb: 'Posts you have saved'
  },
  lists: {
    href: '/lists',
    label: 'Lists',
    icon: List,
    blurb: 'Curated timelines and collections'
  },
  fitness: {
    // Overridden by `fitnessUrl`; the account-scoped section has no fixed path.
    href: '/fitness',
    label: 'Fitness',
    icon: Activity,
    blurb: 'Activity dashboard, files, heatmaps'
  },
  notifications: {
    href: '/notifications',
    label: 'Notifications',
    shortLabel: 'Alerts',
    icon: Bell,
    blurb: 'Replies, likes, and mentions'
  },
  admin: {
    href: '/admin',
    label: 'Admin',
    icon: Shield,
    blurb: 'Instance moderation (admins only)'
  },
  account: {
    href: '/account',
    label: 'Account',
    icon: Users,
    blurb: 'Settings shared across your actors'
  },
  settings: {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    blurb: 'Settings for this actor'
  }
}

export interface BuildNavItemsParams {
  fitnessUrl?: string
  isAdmin?: boolean
  // Instance features an admin can switch off. Missing keys default to on.
  features?: Partial<NavFeatureFlags>
}

const isFeatureEnabled = (
  id: NavItemId,
  features: Partial<NavFeatureFlags> | undefined
) => {
  const feature = NAV_FEATURE_BY_ID[id]
  return !feature || features?.[feature] !== false
}

/**
 * What this viewer can reach at all: role-gated items (Admin), account-gated
 * ones (Fitness), and anything an admin has switched off instance-wide. Items
 * outside this set render nowhere, but keep their slot in the saved order.
 */
export const availableNavIds = ({
  fitnessUrl,
  isAdmin = false,
  features
}: BuildNavItemsParams): Set<NavItemId> =>
  new Set(
    DEFAULT_NAV_ORDER.filter((id) => {
      if (!isFeatureEnabled(id, features)) return false
      if (id === 'fitness') return Boolean(fitnessUrl)
      if (id === 'admin') return isAdmin
      return true
    })
  )

export const getNavItem = (
  id: NavItemId,
  { fitnessUrl }: BuildNavItemsParams = {}
): NavItem => {
  const definition = NAV_ITEM_DEFINITIONS[id]
  return {
    ...definition,
    id,
    href: id === 'fitness' && fitnessUrl ? fitnessUrl : definition.href,
    locked: isNavItemLocked(id),
    feature: NAV_FEATURE_BY_ID[id]
  }
}

export interface NavLayout {
  // Rendered in the navigation itself, in the user's order.
  shown: NavItem[]
  // Hidden by the user: still reachable, tucked under "More".
  more: NavItem[]
}

// The settings manager deliberately builds its rows from `useNavPreferences()`
// rather than from here: it lists every id the account can reach, hidden ones
// included, which is the opposite of what a navigation surface wants.

/**
 * The whole navigation for one viewer: what they see, what they tucked under
 * More, and the full order behind both. Every surface renders from this.
 */
export function buildNavLayout(
  params: BuildNavItemsParams & { prefs?: NavPreferences } = {}
): NavLayout {
  const { prefs = {}, ...availabilityParams } = params
  const availability = availableNavIds(availabilityParams)
  const { shown, more } = splitNav(prefs, availability)
  return {
    shown: shown.map((id) => getNavItem(id, availabilityParams)),
    more: more.map((id) => getNavItem(id, availabilityParams))
  }
}

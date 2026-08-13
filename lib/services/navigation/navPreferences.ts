// The navigation customization domain model: which nav items exist, which are
// pinned, which belong to an optional instance feature, and the pure algebra
// that turns a user's saved preferences into an ordered, split navigation.
//
// It lives here, away from the components, because both sides consume it: the
// `'use client'` sidebar/mobile-nav/settings manager render from it, and the
// server route that persists preferences validates against it. Keep this module
// free of React, lucide, and env access so importing it from a Server Component
// or an API route stays safe (see the Server/Client Module Boundary section in
// AGENTS.md).
export const NAV_ITEM_IDS = [
  'timeline',
  'search',
  'explore',
  'messages',
  'favorites',
  'bookmarks',
  'lists',
  'fitness',
  'notifications',
  'admin',
  'account',
  'settings'
] as const

export type NavItemId = (typeof NAV_ITEM_IDS)[number]

// The order items ship in. `NAV_ITEM_IDS` is already written in that order, so
// the default order is the registry order.
export const DEFAULT_NAV_ORDER: readonly NavItemId[] = NAV_ITEM_IDS

// Pinned items. They can still be reordered, but never hidden: they are either
// the only way back to a section that hides things (Settings, Account) or the
// core reading surfaces (Timeline, Search, Lists, Notifications).
export const LOCKED_NAV_IDS: ReadonlySet<NavItemId> = new Set<NavItemId>([
  'timeline',
  'search',
  'lists',
  'notifications',
  'account',
  'settings'
])

// Optional features an instance admin can switch off for every account.
export const NAV_FEATURE_KEYS = ['fitness', 'explore', 'messages'] as const
export type NavFeatureKey = (typeof NAV_FEATURE_KEYS)[number]
export type NavFeatureFlags = Record<NavFeatureKey, boolean>

export const NAV_FEATURE_BY_ID: Partial<Record<NavItemId, NavFeatureKey>> = {
  fitness: 'fitness',
  explore: 'explore',
  messages: 'messages'
}

export const DEFAULT_NAV_FEATURES: NavFeatureFlags = {
  fitness: true,
  explore: true,
  messages: true
}

export interface NavPreferences {
  navOrder?: string[]
  navHidden?: string[]
}

const NAV_ITEM_ID_SET: ReadonlySet<string> = new Set<string>(NAV_ITEM_IDS)

export const isNavItemId = (value: string): value is NavItemId =>
  NAV_ITEM_ID_SET.has(value)

export const isNavItemLocked = (id: NavItemId): boolean =>
  LOCKED_NAV_IDS.has(id)

const dedupeKnownIds = (input: readonly string[] | undefined): NavItemId[] => {
  if (!input) return []
  const seen = new Set<NavItemId>()
  for (const value of input) {
    if (isNavItemId(value)) seen.add(value)
  }
  return [...seen]
}

/**
 * The user's order as a complete permutation of the known items: ids this
 * release no longer ships are dropped, and items the saved order predates are
 * appended in their default relative order, so a newly shipped nav item shows
 * up for everyone instead of disappearing behind a stale preference.
 */
export const normalizedOrder = (prefs: NavPreferences): NavItemId[] => {
  const kept = dedupeKnownIds(prefs.navOrder)
  const keptSet = new Set(kept)
  return [...kept, ...DEFAULT_NAV_ORDER.filter((id) => !keptSet.has(id))]
}

/**
 * The hidden set, restricted to ids that exist and are allowed to hide. Pinned
 * ids are dropped rather than honored: a stale or hand-edited preference must
 * not be able to hide Settings and strand the user.
 */
export const normalizedHidden = (prefs: NavPreferences): NavItemId[] => {
  const hidden = new Set(
    dedupeKnownIds(prefs.navHidden).filter((id) => !isNavItemLocked(id))
  )
  return normalizedOrder(prefs).filter((id) => hidden.has(id))
}

export interface NavSplit {
  shown: NavItemId[]
  more: NavItemId[]
}

/**
 * The two lists the navigation renders. `availability` is what this viewer can
 * reach at all (role and instance feature flags); those ids land in neither
 * list, while their slot survives in the stored order so re-enabling a feature
 * restores the layout the user had.
 */
export const splitNav = (
  prefs: NavPreferences,
  availability: ReadonlySet<NavItemId>
): NavSplit => {
  const hidden = new Set(normalizedHidden(prefs))
  const available = normalizedOrder(prefs).filter((id) => availability.has(id))
  return {
    shown: available.filter((id) => !hidden.has(id)),
    more: available.filter((id) => hidden.has(id))
  }
}

/**
 * Swap `id` with its nearest *visible* neighbour, keeping hidden and
 * unavailable items in their slots so they come back where the user left them.
 * Returns the original array when the move would run off either end, which lets
 * callers skip a pointless save.
 */
export const moveNavItem = (
  order: readonly NavItemId[],
  visible: ReadonlySet<NavItemId>,
  id: NavItemId,
  direction: -1 | 1
): NavItemId[] => {
  const visibleOrder = order.filter((item) => visible.has(item))
  const from = visibleOrder.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= visibleOrder.length) return [...order]

  const next = [...order]
  const fromIndex = next.indexOf(visibleOrder[from])
  const toIndex = next.indexOf(visibleOrder[to])
  next[fromIndex] = visibleOrder[to]
  next[toIndex] = visibleOrder[from]
  return next
}

/**
 * Move `dragId` to `overId`'s position in the full order. Used by the settings
 * manager, which lists every item, so it splices rather than swapping.
 */
export const moveNavItemTo = (
  order: readonly NavItemId[],
  dragId: NavItemId,
  overId: NavItemId
): NavItemId[] => {
  const next = [...order]
  if (dragId === overId) return next

  const from = next.indexOf(dragId)
  const to = next.indexOf(overId)
  if (from < 0 || to < 0) return next

  next.splice(from, 1)
  next.splice(to, 0, dragId)
  return next
}

// Request sanitizers. The browser sends whatever it has; persist only ids this
// release knows, without duplicates, and never a pinned id in the hidden list.
export const sanitizeNavOrder = (input: readonly string[]): NavItemId[] =>
  dedupeKnownIds(input)

export const sanitizeNavHidden = (input: readonly string[]): NavItemId[] =>
  dedupeKnownIds(input).filter((id) => !isNavItemLocked(id))

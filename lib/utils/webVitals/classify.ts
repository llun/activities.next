import type {
  WebVitalDevice,
  WebVitalNavigationType,
  WebVitalRoute
} from './types'
import { WEB_VITAL_NAVIGATION_TYPES } from './types'

const safeDecode = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// First segments whose whole subtree is one bucket. The tree under each is
// large and unbounded (ids, tags), and a per-page breakdown would be noise.
const SECTION_ROUTES = new Map<string, WebVitalRoute>([
  ['settings', '/settings/*'],
  ['account', '/account/*'],
  ['admin', '/admin/*'],
  ['auth', '/auth/*'],
  ['oauth', '/auth/*'],
  ['authorize_interaction', '/auth/*'],
  ['gallery', '/gallery/*']
])

const SINGLE_PAGE_ROUTES = new Map<string, WebVitalRoute>([
  ['notifications', '/notifications'],
  ['explore', '/explore'],
  ['search', '/search'],
  ['bookmarks', '/bookmarks'],
  ['favorites', '/favorites'],
  ['messages', '/messages']
])

const actorRoute = (rest: string[]): WebVitalRoute => {
  if (rest.length === 0) return '/[actor]'
  if (rest.length === 1) {
    const [segment] = rest
    if (segment === 'followers') return '/[actor]/followers'
    if (segment === 'following') return '/[actor]/following'
    if (segment === 'fitness') return '/[actor]/fitness'
    if (segment === 'albums') return 'other'
    return '/[actor]/[status]'
  }
  if (rest[0] === 'albums' && rest.length === 2) return '/[actor]/albums/[id]'
  if (rest[0] === 'fitness' && rest[1] === 'heatmap' && rest.length === 2) {
    return '/[actor]/fitness/heatmap'
  }
  return 'other'
}

/**
 * Maps a pathname onto a fixed route template. The result is always one of
 * `WEB_VITAL_ROUTES`: no actor handle, status id, tag, token or any other
 * part of the pathname can reach a report. Pass a pathname only, never a URL
 * with a query string or fragment; one that has them is cut at the first `?`
 * or `#`.
 */
export const getWebVitalsRoute = (pathname: string): WebVitalRoute => {
  const path = pathname.split(/[?#]/)[0]
  const segments = path.split('/').filter(Boolean).map(safeDecode)
  if (segments.length === 0) return '/'

  const [first, ...rest] = segments
  if (first.startsWith('@')) return actorRoute(rest)

  const section = SECTION_ROUTES.get(first)
  if (section) return section
  const singlePage = SINGLE_PAGE_ROUTES.get(first)
  if (singlePage) return rest.length === 0 ? singlePage : 'other'

  switch (first) {
    case 'tags':
      return rest.length === 1 ? '/tags/[tag]' : 'other'
    case 'collections':
      if (rest.length === 1 && rest[0] !== 'new') return '/collections/[id]'
      return rest.length > 0 ? '/collections/*' : 'other'
    case 'lists':
      return rest.length === 0 ? '/lists' : '/lists/*'
    case 'fitness':
      return rest.length === 0 ? '/fitness' : '/fitness/*'
    case 'u':
      return rest.length === 2 && rest[0] === 'heatmaps'
        ? '/u/heatmaps/[token]'
        : 'other'
    case 'embed':
      return rest.length === 2 && rest[0] === 'heatmap'
        ? '/embed/heatmap/[token]'
        : 'other'
    default:
      return 'other'
  }
}

// The app's `md` and `lg` breakpoints.
export const getWebVitalsDevice = (viewportWidth: number): WebVitalDevice => {
  if (viewportWidth < 768) return 'mobile'
  if (viewportWidth < 1024) return 'tablet'
  return 'desktop'
}

export const toWebVitalNavigationType = (
  value: unknown
): WebVitalNavigationType =>
  WEB_VITAL_NAVIGATION_TYPES.find((type) => type === value) ?? 'other'

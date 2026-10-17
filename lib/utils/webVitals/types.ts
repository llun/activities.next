// Shared by the browser reporter and the report endpoint, so it stays
// dependency-free: no React, no zod, no env, no logger.

export const WEB_VITAL_NAMES = ['LCP', 'CLS', 'INP'] as const
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number]

export const WEB_VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const
export type WebVitalRating = (typeof WEB_VITAL_RATINGS)[number]

export const WEB_VITAL_NAVIGATION_TYPES = [
  'navigate',
  'reload',
  'back-forward',
  'back-forward-cache',
  'prerender',
  'restore',
  'soft-navigation',
  'other'
] as const
export type WebVitalNavigationType = (typeof WEB_VITAL_NAVIGATION_TYPES)[number]

export const WEB_VITAL_DEVICES = ['mobile', 'tablet', 'desktop'] as const
export type WebVitalDevice = (typeof WEB_VITAL_DEVICES)[number]

// The only `route` values a report may carry. `getWebVitalsRoute` maps a
// pathname onto one of these; anything unrecognised is `other`.
export const WEB_VITAL_ROUTES = [
  '/',
  '/[actor]',
  '/[actor]/[status]',
  '/[actor]/followers',
  '/[actor]/following',
  '/[actor]/fitness',
  '/[actor]/fitness/heatmap',
  '/[actor]/albums/[id]',
  '/tags/[tag]',
  '/collections/[id]',
  '/collections/*',
  '/lists',
  '/lists/*',
  '/notifications',
  '/explore',
  '/search',
  '/bookmarks',
  '/favorites',
  '/messages',
  '/fitness',
  '/fitness/*',
  '/gallery/*',
  '/settings/*',
  '/account/*',
  '/admin/*',
  '/auth/*',
  '/u/heatmaps/[token]',
  '/embed/heatmap/[token]',
  'other'
] as const
export type WebVitalRoute = (typeof WEB_VITAL_ROUTES)[number]

export interface WebVitalMetricReport {
  name: WebVitalName
  value: number
  rating: WebVitalRating
  navigationType: WebVitalNavigationType
  route: WebVitalRoute
  device: WebVitalDevice
}

export interface WebVitalsReport {
  metrics: WebVitalMetricReport[]
}

export const WEB_VITALS_MAX_METRICS_PER_REPORT = 6
// A report is a few hundred bytes; the cap only turns abuse away.
export const WEB_VITALS_MAX_REPORT_BYTES = 2048

// Upper bounds a real measurement cannot exceed (a metric past it is a bug or
// a forged report). LCP and INP are milliseconds; CLS is unitless.
export const WEB_VITAL_MAX_VALUE: Record<WebVitalName, number> = {
  LCP: 120_000,
  INP: 60_000,
  CLS: 10
}

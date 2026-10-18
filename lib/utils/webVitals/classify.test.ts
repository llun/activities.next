import {
  getWebVitalsDevice,
  getWebVitalsRoute,
  toWebVitalNavigationType
} from './classify'
import { WEB_VITAL_NAVIGATION_TYPES, WEB_VITAL_ROUTES } from './types'

describe('getWebVitalsRoute', () => {
  it.each([
    ['/', '/'],
    ['/@alice@example.com', '/[actor]'],
    ['/%40alice%40example.com', '/[actor]'],
    ['/@alice@example.com/0190abcd-1234', '/[actor]/[status]'],
    ['/@alice@example.com/followers', '/[actor]/followers'],
    ['/@alice@example.com/following', '/[actor]/following'],
    ['/@alice@example.com/fitness', '/[actor]/fitness'],
    ['/@alice@example.com/fitness/heatmap', '/[actor]/fitness/heatmap'],
    ['/@alice@example.com/albums/42', '/[actor]/albums/[id]'],
    ['/@alice@example.com/albums', 'other'],
    ['/@alice@example.com/a/b/c', 'other'],
    ['/tags/running', '/tags/[tag]'],
    ['/tags', 'other'],
    ['/tags/a/b', 'other'],
    ['/tags/run#frag/x', '/tags/[tag]'],
    ['/search/extra', 'other'],
    ['/u/heatmaps', 'other'],
    ['/u/heatmaps/t/extra', 'other'],
    ['/@alice@example.com/fitness/heatmap/extra', 'other'],
    ['/@alice@example.com/albums/42/extra', 'other'],
    ['/lists', '/lists'],
    ['/lists/abc/edit', '/lists/*'],
    ['/notifications', '/notifications'],
    ['/explore', '/explore'],
    ['/search', '/search'],
    ['/bookmarks', '/bookmarks'],
    ['/favorites', '/favorites'],
    ['/messages', '/messages'],
    ['/fitness', '/fitness'],
    ['/fitness/gear/abc', '/fitness/*'],
    ['/gallery/subjects/some-key', '/gallery/*'],
    ['/settings/preferences', '/settings/*'],
    ['/account/security', '/account/*'],
    ['/admin/accounts/abc', '/admin/*'],
    ['/auth/signin', '/auth/*'],
    ['/oauth/authorize', '/auth/*'],
    ['/authorize_interaction', '/auth/*'],
    ['/u/heatmaps/secret-token', '/u/heatmaps/[token]'],
    ['/embed/heatmap/secret-token', '/embed/heatmap/[token]'],
    ['/embed/heatmap/secret-token/tiles', 'other'],
    ['/constructor', 'other'],
    ['/toString/x', 'other'],
    ['/app', '/app'],
    ['/app/extra', 'other'],
    ['/something/else', 'other'],
    ['', '/']
  ])('maps %s to %s', (pathname, expected) => {
    expect(getWebVitalsRoute(pathname)).toBe(expected)
  })

  it('cuts a query string or fragment off before mapping', () => {
    expect(getWebVitalsRoute('/search?q=secret')).toBe('/search')
    expect(getWebVitalsRoute('/tags/run#frag')).toBe('/tags/[tag]')
  })

  it('survives a malformed percent escape', () => {
    expect(getWebVitalsRoute('/@alice%E0%A4%A@example.com')).toBe('/[actor]')
  })

  it.each([
    '/@alice@example.com/0190abcd-1234',
    '/tags/very-private-tag',
    '/u/heatmaps/tok3n-value',
    '/embed/heatmap/tok3n-value',
    '/@alice@example.com/albums/album-id-9',
    '/gallery/subjects/subject-key-7',
    '/admin/accounts/account-id-5',
    '/anything/with/an/id-abcdef/deep'
  ])('never lets part of %s into the result', (pathname) => {
    const route = getWebVitalsRoute(pathname)

    expect(WEB_VITAL_ROUTES).toContain(route)
    expect(route).not.toMatch(/alice|0190abcd|private|tok3n|coll-id|album-id/)
    expect(route).not.toMatch(/subject-key|account-id|id-abcdef/)
  })
})

describe('getWebVitalsDevice', () => {
  it.each([
    [0, 'mobile'],
    [390, 'mobile'],
    [767, 'mobile'],
    [768, 'tablet'],
    [1023, 'tablet'],
    [1024, 'desktop'],
    [2560, 'desktop']
  ])('classifies a %d px viewport as %s', (width, expected) => {
    expect(getWebVitalsDevice(width)).toBe(expected)
  })
})

const navigationTypeRows: [unknown, string][] = [
  ['navigate', 'navigate'],
  ['reload', 'reload'],
  ['back-forward', 'back-forward'],
  ['back-forward-cache', 'back-forward-cache'],
  ['prerender', 'prerender'],
  ['restore', 'restore'],
  ['soft-navigation', 'soft-navigation'],
  ['other', 'other'],
  ['something-new', 'other'],
  [undefined, 'other'],
  [42, 'other']
]

describe('toWebVitalNavigationType', () => {
  it.each(navigationTypeRows)('maps %s to %s', (value, expected) => {
    expect(toWebVitalNavigationType(value)).toBe(expected)
  })

  it('has an identity row for every navigation type', () => {
    const identityRows = navigationTypeRows
      .filter(([value, expected]) => value === expected)
      .map(([value]) => value)
    expect([...identityRows].sort()).toEqual(
      [...WEB_VITAL_NAVIGATION_TYPES].sort()
    )
  })
})

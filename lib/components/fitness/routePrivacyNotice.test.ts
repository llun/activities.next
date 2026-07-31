/** @vitest-environment jsdom */
import {
  dismissRoutePrivacyNotice,
  getRoutePrivacyNoticeStorageKey,
  isRoutePrivacyNoticeDismissed
} from '@/lib/components/fitness/routePrivacyNotice'

const ACTOR_ID = 'https://activities.local/users/athlete'
const OTHER_ACTOR_ID = 'https://activities.local/users/sibling'

describe('getRoutePrivacyNoticeStorageKey', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('scopes the key to the actor', () => {
    expect(getRoutePrivacyNoticeStorageKey(ACTOR_ID)).toBe(
      `fitness:activity-route-privacy-notice-dismissed:${ACTOR_ID}`
    )
  })

  it.each([
    { description: 'no actor', actorId: undefined },
    { description: 'a null actor', actorId: null },
    { description: 'an empty actor id', actorId: '' }
  ])('falls back to the bare prefix for $description', ({ actorId }) => {
    expect(getRoutePrivacyNoticeStorageKey(actorId)).toBe(
      'fitness:activity-route-privacy-notice-dismissed'
    )
  })

  it('names the activity route map, not fitness routes in general', () => {
    // The heatmap surfaces draw the same privacy distinction in blue and carry
    // no notice; one added there must not be born pre-dismissed by this key.
    expect(getRoutePrivacyNoticeStorageKey(ACTOR_ID)).toContain(
      'activity-route'
    )
  })
})

describe('isRoutePrivacyNoticeDismissed', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reports not dismissed when nothing is stored', () => {
    expect(isRoutePrivacyNoticeDismissed(ACTOR_ID)).toBe(false)
  })

  it.each([
    { description: 'an unrelated value', stored: 'maybe' },
    { description: 'the false string', stored: 'false' },
    { description: 'an empty value', stored: '' }
  ])('reports not dismissed for $description', ({ stored }) => {
    window.localStorage.setItem(
      getRoutePrivacyNoticeStorageKey(ACTOR_ID),
      stored
    )

    expect(isRoutePrivacyNoticeDismissed(ACTOR_ID)).toBe(false)
  })

  it('does not report another actor’s dismissal', () => {
    dismissRoutePrivacyNotice(OTHER_ACTOR_ID)

    expect(isRoutePrivacyNoticeDismissed(ACTOR_ID)).toBe(false)
    expect(isRoutePrivacyNoticeDismissed(OTHER_ACTOR_ID)).toBe(true)
  })

  it('reports not dismissed when storage access throws', () => {
    // Private modes and sandboxed iframes throw on access rather than returning
    // null; the notice degrades to non-persistent instead of crashing the map.
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    expect(isRoutePrivacyNoticeDismissed(ACTOR_ID)).toBe(false)
  })
})

describe('dismissRoutePrivacyNotice', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('remembers the dismissal for later reads', () => {
    dismissRoutePrivacyNotice(ACTOR_ID)

    expect(
      window.localStorage.getItem(getRoutePrivacyNoticeStorageKey(ACTOR_ID))
    ).toBe('true')
    expect(isRoutePrivacyNoticeDismissed(ACTOR_ID)).toBe(true)
  })

  it('swallows a storage write failure', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() => dismissRoutePrivacyNotice(ACTOR_ID)).not.toThrow()
  })
})

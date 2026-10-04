import {
  MAX_ENTRIES,
  getInAppPrevious,
  recordNavigation,
  resetInAppHistory,
  subscribeToInAppHistory
} from './inAppHistory'

describe('inAppHistory', () => {
  beforeEach(() => {
    resetInAppHistory()
  })

  it('has no previous page on direct entry, before or after the page is recorded', () => {
    expect(getInAppPrevious('/@alice@example.com/1')).toBeNull()
    recordNavigation('/@alice@example.com/1')
    expect(getInAppPrevious('/@alice@example.com/1')).toBeNull()
  })

  it('names the page navigated from before and after the new page is recorded', () => {
    recordNavigation('/notifications')
    // The first render of the post happens before the tracker's effect.
    expect(getInAppPrevious('/@alice@example.com/1')).toBe('/notifications')
    recordNavigation('/@alice@example.com/1')
    expect(getInAppPrevious('/@alice@example.com/1')).toBe('/notifications')
  })

  it('reads a return to the previous entry as a back navigation and pops', () => {
    recordNavigation('/@alice@example.com/1')
    recordNavigation('/@alice@example.com')
    // Browser Back to the post: the post is the entry below the profile.
    recordNavigation('/@alice@example.com/1')
    // The post was the first page in this tab, so nothing precedes it now.
    expect(getInAppPrevious('/@alice@example.com/1')).toBeNull()
  })

  // A multi-step jump back to the entry page, e.g. `history.go(-2)`. A record
  // that read only a return to the entry directly below the top as a Back
  // would push here, leaving [P0, X, Y, P0] and offering a `router.back()`
  // that leaves the app. What this guards is the rule that a recorded
  // pathname has something before it only when it is not the bottom entry.
  it('offers no Back after a multi-step return to the entry page', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/y')
    expect(getInAppPrevious('/p0')).toBeNull()
    recordNavigation('/p0')
    expect(getInAppPrevious('/p0')).toBeNull()
  })

  // The entry page reached again by link, then by a jump back. The stack reads
  // every visit to P0 as the bottom entry — on the linked one that errs
  // towards the fallback link, but on the jump it is what keeps Back in the
  // app.
  it('offers no Back on the entry page however often it was revisited', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/p0')
    recordNavigation('/y')
    recordNavigation('/p0')
    expect(getInAppPrevious('/p0')).toBeNull()
  })

  it('still offers Back on a page returned to that is not the entry page', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/y')
    recordNavigation('/z')
    // The page below a revisited one is what it returns to, not the top.
    expect(getInAppPrevious('/x')).toBe('/p0')
    recordNavigation('/x')
    expect(getInAppPrevious('/x')).toBe('/p0')
    // …and the entry page, reached again, still has nothing before it.
    recordNavigation('/p0')
    expect(getInAppPrevious('/p0')).toBeNull()
  })

  it(`keeps only the latest ${MAX_ENTRIES} pages`, () => {
    for (let i = 0; i <= MAX_ENTRIES; i++) recordNavigation(`/p${i}`)
    // `/p0` fell off the bottom, so `/p1` is the oldest page recorded and a
    // return to it has nothing before it.
    recordNavigation('/p1')
    expect(getInAppPrevious('/p1')).toBeNull()
  })

  it('ignores a repeated record of the current page', () => {
    recordNavigation('/a')
    recordNavigation('/a')
    expect(getInAppPrevious('/a')).toBeNull()
  })

  it('notifies subscribers when the stack changes and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToInAppHistory(listener)
    recordNavigation('/a')
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    unsubscribe()
    recordNavigation('/b')
    expect(listener).not.toHaveBeenCalled()
  })
})

import {
  MAX_ENTRIES,
  hasInAppPrevious,
  recordNavigation,
  resetInAppHistory,
  subscribeToInAppHistory
} from './inAppHistory'

describe('inAppHistory', () => {
  beforeEach(() => {
    resetInAppHistory()
  })

  it('has no previous page on direct entry, before or after the page is recorded', () => {
    expect(hasInAppPrevious('/@alice@example.com/1')).toBe(false)
    recordNavigation('/@alice@example.com/1')
    expect(hasInAppPrevious('/@alice@example.com/1')).toBe(false)
  })

  it('sees the page navigated from before and after the new page is recorded', () => {
    recordNavigation('/')
    // The first render of the post happens before the tracker's effect.
    expect(hasInAppPrevious('/@alice@example.com/1')).toBe(true)
    recordNavigation('/@alice@example.com/1')
    expect(hasInAppPrevious('/@alice@example.com/1')).toBe(true)
  })

  it('reads a return to the previous entry as a back navigation and pops', () => {
    recordNavigation('/@alice@example.com/1')
    recordNavigation('/@alice@example.com')
    // Browser Back to the post: the post is the entry below the profile.
    recordNavigation('/@alice@example.com/1')
    // The post was the first page in this tab, so nothing precedes it now.
    expect(hasInAppPrevious('/@alice@example.com/1')).toBe(false)
  })

  // A multi-step jump back to the entry page, e.g. `history.go(-2)`. Popping
  // one entry would leave [P0, X, Y, P0] and offer a `router.back()` that
  // leaves the app.
  it('offers no Back after a multi-step return to the entry page', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/y')
    expect(hasInAppPrevious('/p0')).toBe(false)
    recordNavigation('/p0')
    expect(hasInAppPrevious('/p0')).toBe(false)
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
    expect(hasInAppPrevious('/p0')).toBe(false)
  })

  it('still offers Back on a page returned to that is not the entry page', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/y')
    recordNavigation('/z')
    expect(hasInAppPrevious('/x')).toBe(true)
    recordNavigation('/x')
    expect(hasInAppPrevious('/x')).toBe(true)
    // …and the jump dropped what lay above it, so stepping back once more
    // reaches the entry page with nothing before it.
    recordNavigation('/p0')
    expect(hasInAppPrevious('/p0')).toBe(false)
  })

  it(`keeps only the latest ${MAX_ENTRIES} pages`, () => {
    for (let i = 0; i <= MAX_ENTRIES; i++) recordNavigation(`/p${i}`)
    // `/p0` fell off the bottom, so `/p1` is the oldest page recorded and a
    // return to it has nothing before it.
    recordNavigation('/p1')
    expect(hasInAppPrevious('/p1')).toBe(false)
  })

  it('ignores a repeated record of the current page', () => {
    recordNavigation('/a')
    recordNavigation('/a')
    expect(hasInAppPrevious('/a')).toBe(false)
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

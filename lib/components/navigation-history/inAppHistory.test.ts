import {
  MAX_ENTRIES,
  getInAppPrevious,
  recordNavigation,
  recordPop,
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

  it('reads a popstate to the previous entry as a Back and pops', () => {
    recordNavigation('/@alice@example.com/1')
    recordNavigation('/@alice@example.com')
    // Browser Back to the post: the post is the entry below the profile.
    recordPop('/@alice@example.com/1')
    // The post was the first page in this tab, so nothing precedes it now.
    expect(getInAppPrevious('/@alice@example.com/1')).toBeNull()
  })

  // The case a pathname alone cannot settle: a link back to a page already on
  // the stack. Reading it as a return would name Notifications, but the link
  // pushed a new entry and `router.back()` goes to the Profile just left.
  it('names the page just left after a link to a page already on the stack', () => {
    recordNavigation('/notifications')
    recordNavigation('/a')
    recordNavigation('/profile')
    // First render of A, before the tracker's effect, and after it.
    expect(getInAppPrevious('/a')).toBe('/profile')
    recordNavigation('/a')
    expect(getInAppPrevious('/a')).toBe('/profile')
  })

  it('unwinds the entries a link pushed as the browser pops them', () => {
    recordNavigation('/notifications')
    recordNavigation('/a')
    recordNavigation('/profile')
    recordNavigation('/a')
    // Back to the Profile: the stack is [notifications, a, profile].
    recordPop('/profile')
    expect(getInAppPrevious('/profile')).toBe('/a')
    // Back again to A: [notifications, a].
    recordPop('/a')
    expect(getInAppPrevious('/a')).toBe('/notifications')
  })

  it('pops to the nearest earlier entry for a repeated pathname', () => {
    recordNavigation('/x')
    recordNavigation('/a')
    recordNavigation('/b')
    recordNavigation('/a')
    recordNavigation('/c')
    recordPop('/a')
    expect(getInAppPrevious('/a')).toBe('/b')
  })

  // A multi-step jump back to the entry page, e.g. `history.go(-2)`.
  it('offers no Back after a multi-step popstate to the entry page', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/y')
    recordPop('/p0')
    expect(getInAppPrevious('/p0')).toBeNull()
  })

  it('pushes a popstate to a pathname that is not on the stack', () => {
    recordNavigation('/a')
    recordNavigation('/b')
    recordPop('/a')
    // Browser Forward after a Back: B is no longer on the stack.
    recordPop('/b')
    recordNavigation('/b')
    expect(getInAppPrevious('/b')).toBe('/a')
  })

  it('ignores a popstate to the current page', () => {
    recordNavigation('/a')
    recordNavigation('/b')
    recordPop('/b')
    expect(getInAppPrevious('/b')).toBe('/a')
  })

  it('names the page below a returned-to page that is not the entry page', () => {
    recordNavigation('/p0')
    recordNavigation('/x')
    recordNavigation('/y')
    recordNavigation('/z')
    recordPop('/x')
    expect(getInAppPrevious('/x')).toBe('/p0')
    recordPop('/p0')
    expect(getInAppPrevious('/p0')).toBeNull()
  })

  it('names the previous page from a stack of several entries', () => {
    recordNavigation('/a')
    recordNavigation('/b')
    // Not yet recorded: `/c` will be pushed on top of `/b`.
    expect(getInAppPrevious('/c')).toBe('/b')
    recordNavigation('/c')
    expect(getInAppPrevious('/c')).toBe('/b')
  })

  it(`keeps only the latest ${MAX_ENTRIES} pages`, () => {
    for (let i = 0; i <= MAX_ENTRIES; i++) recordNavigation(`/p${i}`)
    // `/p0` fell off the bottom, so `/p1` is the oldest page recorded and a
    // return to it has nothing before it.
    recordPop('/p1')
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

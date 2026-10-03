import {
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

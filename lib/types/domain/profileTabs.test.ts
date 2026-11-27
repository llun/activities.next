import {
  PROFILE_TAB_LABELS,
  SHOW_ALL_PROFILE_TABS,
  getAvailableProfileTabs
} from '@/lib/types/domain/profileTabs'

const ALL_CONTENT = { hasMedia: true, hasGallery: true, hasFitness: true }

describe('getAvailableProfileTabs', () => {
  it('returns every tab in display order', () => {
    expect(
      getAvailableProfileTabs({
        tabVisibility: SHOW_ALL_PROFILE_TABS,
        isInternalAccount: true,
        content: ALL_CONTENT
      })
    ).toEqual(['posts', 'replies', 'media', 'gallery', 'fitness'])
  })

  it.each([
    { hidden: 'replies' as const, tab: 'replies' },
    { hidden: 'media' as const, tab: 'media' },
    { hidden: 'gallery' as const, tab: 'gallery' },
    { hidden: 'fitness' as const, tab: 'fitness' }
  ])('drops $tab when its switch is off', ({ hidden, tab }) => {
    const tabs = getAvailableProfileTabs({
      tabVisibility: { ...SHOW_ALL_PROFILE_TABS, [hidden]: false },
      isInternalAccount: true,
      content: ALL_CONTENT
    })

    expect(tabs).not.toContain(tab)
    expect(tabs[0]).toBe('posts')
  })

  it('offers no content-gated tab when there is no content', () => {
    expect(
      getAvailableProfileTabs({
        tabVisibility: SHOW_ALL_PROFILE_TABS,
        isInternalAccount: true,
        content: { hasMedia: false, hasGallery: false, hasFitness: false }
      })
    ).toEqual(['posts', 'replies'])
  })

  it('never offers Replies to a remote account', () => {
    expect(
      getAvailableProfileTabs({
        tabVisibility: SHOW_ALL_PROFILE_TABS,
        isInternalAccount: false,
        content: ALL_CONTENT
      })
    ).toEqual(['posts', 'media', 'gallery', 'fitness'])
  })
})

describe('PROFILE_TAB_LABELS', () => {
  it('labels every tab', () => {
    expect(PROFILE_TAB_LABELS).toEqual({
      posts: 'Posts',
      replies: 'Replies',
      media: 'Media',
      gallery: 'Gallery',
      fitness: 'Fitness'
    })
  })
})

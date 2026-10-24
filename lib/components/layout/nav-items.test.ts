import { buildNavLayout } from '@/lib/components/layout/nav-items'

const itemHrefs = (params: Parameters<typeof buildNavLayout>[0]) =>
  buildNavLayout(params).shown.map((item) => item.href)

describe('buildNavLayout', () => {
  it('places favorites before bookmarks and profile before settings in the base navigation', () => {
    expect(itemHrefs({ profileUrl: '/@llun' })).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/drafts',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/@llun',
      '/settings'
    ])
  })

  it('omits profile when profileUrl is not provided', () => {
    expect(itemHrefs({})).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/drafts',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/settings'
    ])
  })

  it('anchors fitness before notifications', () => {
    expect(
      itemHrefs({
        fitnessUrl: '/@llun@llun.test/fitness',
        profileUrl: '/@llun'
      })
    ).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/drafts',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/@llun@llun.test/fitness',
      '/notifications',
      '/@llun',
      '/settings'
    ])
  })

  it('anchors admin before profile', () => {
    expect(itemHrefs({ isAdmin: true, profileUrl: '/@llun' })).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/drafts',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/admin',
      '/@llun',
      '/settings'
    ])
  })

  it('keeps fitness and admin anchored when both are present', () => {
    expect(
      itemHrefs({
        fitnessUrl: '/@llun@llun.test/fitness',
        isAdmin: true,
        profileUrl: '/@llun'
      })
    ).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/drafts',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/@llun@llun.test/fitness',
      '/notifications',
      '/admin',
      '/@llun',
      '/settings'
    ])
  })

  it.each([
    ['fitness', { fitness: false }, '/fitness'],
    ['explore', { explore: false }, '/explore'],
    ['messages', { messages: false }, '/messages']
  ])(
    'drops %s when the instance turns the feature off',
    (_, features, href) => {
      expect(itemHrefs({ fitnessUrl: '/fitness', features })).not.toContain(
        href
      )
    }
  )

  it('keeps every item shown when the user has no preference', () => {
    const { shown, more } = buildNavLayout({ profileUrl: '/@llun' })
    expect(more).toEqual([])
    expect(shown.map((item) => item.id)).toEqual([
      'timeline',
      'search',
      'explore',
      'messages',
      'drafts',
      'favorites',
      'bookmarks',
      'lists',
      'notifications',
      'profile',
      'settings'
    ])
  })

  it('moves hidden items into more', () => {
    const { shown, more } = buildNavLayout({
      prefs: { navHidden: ['favorites', 'bookmarks'] }
    })
    expect(shown.map((item) => item.id)).not.toContain('favorites')
    expect(more.map((item) => item.id)).toEqual(['favorites', 'bookmarks'])
  })

  it('follows the user order', () => {
    const { shown } = buildNavLayout({
      prefs: { navOrder: ['settings', 'search'] }
    })
    expect(shown.slice(0, 2).map((item) => item.id)).toEqual([
      'settings',
      'search'
    ])
  })

  it('renders an item the instance turned off nowhere, hidden or not', () => {
    const { shown, more } = buildNavLayout({
      features: { fitness: false },
      fitnessUrl: '/fitness',
      prefs: { navHidden: ['fitness'] }
    })
    expect([...shown, ...more].map((item) => item.id)).not.toContain('fitness')
  })

  it('points the fitness item at the actor fitness url', () => {
    const { shown } = buildNavLayout({ fitnessUrl: '/@llun@llun.test/fitness' })
    expect(shown.find((item) => item.id === 'fitness')?.href).toEqual(
      '/@llun@llun.test/fitness'
    )
  })

  it('offers the gallery item only with a gallery url', () => {
    expect(buildNavLayout({}).shown.some((item) => item.id === 'gallery')).toBe(
      false
    )
    const { shown } = buildNavLayout({ galleryUrl: '/gallery' })
    const ids = shown.map((item) => item.id)
    expect(ids.indexOf('gallery')).toBe(ids.indexOf('notifications') - 1)
    expect(shown.find((item) => item.id === 'gallery')?.href).toEqual(
      '/gallery'
    )
  })

  it('offers the profile item only with a profile url and points to it', () => {
    expect(buildNavLayout({}).shown.some((item) => item.id === 'profile')).toBe(
      false
    )
    const { shown } = buildNavLayout({ profileUrl: '/@llun' })
    const ids = shown.map((item) => item.id)
    expect(ids.indexOf('profile')).toBe(ids.indexOf('settings') - 1)
    expect(shown.find((item) => item.id === 'profile')?.href).toEqual('/@llun')
  })

  it('allows profile to be hidden under more', () => {
    const { shown, more } = buildNavLayout({
      profileUrl: '/@llun',
      prefs: { navHidden: ['profile'] }
    })
    expect(shown.map((item) => item.id)).not.toContain('profile')
    expect(more.map((item) => item.id)).toContain('profile')
  })

  it('never contains an account nav item', () => {
    const layout = buildNavLayout({
      profileUrl: '/@llun',
      fitnessUrl: '/fitness',
      galleryUrl: '/gallery',
      isAdmin: true
    })
    const allIds = [...layout.shown, ...layout.more].map((item) => item.id)
    expect(allIds).not.toContain('account')
  })

  it('marks pinned items as locked', () => {
    const { shown } = buildNavLayout({ profileUrl: '/@llun' })
    const locked = shown.filter((item) => item.locked).map((item) => item.id)
    expect(locked).toEqual([
      'timeline',
      'search',
      'lists',
      'notifications',
      'settings'
    ])
    expect(shown.find((item) => item.id === 'profile')?.locked).toBe(false)
  })
})

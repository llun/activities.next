import { buildNavLayout } from '@/lib/components/layout/nav-items'

const itemHrefs = (params: Parameters<typeof buildNavLayout>[0]) =>
  buildNavLayout(params).shown.map((item) => item.href)

describe('buildNavLayout', () => {
  it('places favorites before bookmarks and account before settings in the base navigation', () => {
    expect(itemHrefs({})).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/account',
      '/settings'
    ])
  })

  it('anchors fitness before notifications', () => {
    expect(itemHrefs({ fitnessUrl: '/@llun@llun.test/fitness' })).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/@llun@llun.test/fitness',
      '/notifications',
      '/account',
      '/settings'
    ])
  })

  it('anchors admin before account', () => {
    expect(itemHrefs({ isAdmin: true })).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/admin',
      '/account',
      '/settings'
    ])
  })

  it('keeps fitness and admin anchored when both are present', () => {
    expect(
      itemHrefs({ fitnessUrl: '/@llun@llun.test/fitness', isAdmin: true })
    ).toEqual([
      '/',
      '/search',
      '/explore',
      '/messages',
      '/favorites',
      '/bookmarks',
      '/lists',
      '/@llun@llun.test/fitness',
      '/notifications',
      '/admin',
      '/account',
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
    const { shown, more } = buildNavLayout({})
    expect(more).toEqual([])
    expect(shown.map((item) => item.id)).toEqual([
      'timeline',
      'search',
      'explore',
      'messages',
      'favorites',
      'bookmarks',
      'lists',
      'notifications',
      'account',
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

  it('lists unavailable items in the order but renders them nowhere', () => {
    const { shown, more, order } = buildNavLayout({
      features: { fitness: false },
      fitnessUrl: '/fitness',
      prefs: { navHidden: ['fitness'] }
    })
    expect(order).toContain('fitness')
    expect([...shown, ...more].map((item) => item.id)).not.toContain('fitness')
  })

  it('points the fitness item at the actor fitness url', () => {
    const { shown } = buildNavLayout({ fitnessUrl: '/@llun@llun.test/fitness' })
    expect(shown.find((item) => item.id === 'fitness')?.href).toEqual(
      '/@llun@llun.test/fitness'
    )
  })

  it('marks pinned items as locked', () => {
    const { shown } = buildNavLayout({})
    const locked = shown.filter((item) => item.locked).map((item) => item.id)
    expect(locked).toEqual([
      'timeline',
      'search',
      'lists',
      'notifications',
      'account',
      'settings'
    ])
  })
})

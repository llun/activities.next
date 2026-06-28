import { buildNavItems } from '@/lib/components/layout/nav-items'

const itemHrefs = (params: Parameters<typeof buildNavItems>[0]) =>
  buildNavItems(params).map((item) => item.href)

describe('buildNavItems', () => {
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
})

import { buildNavItems } from '@/lib/components/layout/nav-items'

const itemHrefs = (params: Parameters<typeof buildNavItems>[0]) =>
  buildNavItems(params).map((item) => item.href)

describe('buildNavItems', () => {
  it('places bookmarks before notifications in the base navigation', () => {
    expect(itemHrefs({})).toEqual([
      '/',
      '/search',
      '/messages',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/settings'
    ])
  })

  it('anchors fitness before notifications', () => {
    expect(itemHrefs({ fitnessUrl: '/@llun@llun.test/fitness' })).toEqual([
      '/',
      '/search',
      '/messages',
      '/bookmarks',
      '/lists',
      '/@llun@llun.test/fitness',
      '/notifications',
      '/settings'
    ])
  })

  it('anchors admin before settings', () => {
    expect(itemHrefs({ isAdmin: true })).toEqual([
      '/',
      '/search',
      '/messages',
      '/bookmarks',
      '/lists',
      '/notifications',
      '/admin',
      '/settings'
    ])
  })

  it('keeps fitness and admin anchored when both are present', () => {
    expect(
      itemHrefs({ fitnessUrl: '/@llun@llun.test/fitness', isAdmin: true })
    ).toEqual([
      '/',
      '/search',
      '/messages',
      '/bookmarks',
      '/lists',
      '/@llun@llun.test/fitness',
      '/notifications',
      '/admin',
      '/settings'
    ])
  })
})

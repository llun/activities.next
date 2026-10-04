import {
  BACK_LABEL,
  PROFILE_BACK_LABEL,
  profileBack,
  profileName,
  resolveBackDestination
} from './backDestination'

describe('resolveBackDestination', () => {
  // One row per family a post or activity can be opened from. Every name
  // contains its visible text (WCAG 2.5.3, Label in Name).
  it.each([
    ['/', 'Back to Timeline'],
    ['/notifications', 'Back to Notifications'],
    ['/search', 'Back to Search'],
    ['/explore', 'Back to Explore'],
    ['/messages', 'Back to Messages'],
    ['/favorites', 'Back to Favorites'],
    ['/bookmarks', 'Back to Bookmarks'],
    ['/lists', 'Back to Lists'],
    ['/lists/new', 'Back to Lists'],
    ['/lists/42', 'Back to list'],
    ['/lists/42/edit', 'Back to list'],
    ['/collections/7', 'Back to collection'],
    ['/collections/new', 'Back to Lists'],
    ['/tags/running', 'Back to #running'],
    ['/tags/caf%C3%A9', 'Back to #café'],
    ['/fitness', 'Back to Fitness'],
    ['/fitness/heatmap', 'Back to Fitness'],
    ['/settings', 'Back to Settings'],
    ['/settings/preferences', 'Back to Settings'],
    ['/account/security', 'Back to Account'],
    ['/admin/reports/3', 'Back to Admin'],
    ['/@anna@llun.social/followers', "Back to @anna@llun.social's followers"],
    ['/@anna@llun.social/following', "Back to @anna@llun.social's following"],
    ['/@anna@llun.social/fitness', "Back to @anna@llun.social's fitness"],
    [
      '/@anna@llun.social/fitness/heatmap',
      "Back to @anna@llun.social's fitness"
    ],
    ['/@anna@llun.social/123', 'Back to post'],
    ['/%40anna%40llun.social/123', 'Back to post']
  ])('shows "Back" and names %s "%s"', (pathname, accessibleName) => {
    expect(resolveBackDestination(pathname)).toEqual({
      label: BACK_LABEL,
      accessibleName
    })
  })

  // A profile is the one destination that reads "Back to profile"; from a
  // pathname only the handle is known.
  it.each(['/@anna@llun.social', '/%40anna%40llun.social'])(
    'shows "Back to profile" for the profile %s, named by its handle',
    (pathname) => {
      expect(resolveBackDestination(pathname)).toEqual({
        label: PROFILE_BACK_LABEL,
        accessibleName: "Back to @anna@llun.social's profile"
      })
    }
  )

  it.each([
    [null],
    [''],
    ['/somewhere/else'],
    ['/tags'],
    ['/constructor'],
    ['/toString'],
    ['/@anna'],
    ['/@anna@llun.social/123/extra'],
    ['/%E0%A4%A'],
    ['relative/path']
  ])('falls back to "Back to previous page" for %s', (pathname) => {
    expect(resolveBackDestination(pathname)).toEqual({
      label: BACK_LABEL,
      accessibleName: 'Back to previous page'
    })
  })
})

describe('profileBack', () => {
  it('shows "Back to profile" and names the person', () => {
    expect(profileBack('Anna Nowak')).toEqual({
      label: 'Back to profile',
      accessibleName: "Back to Anna Nowak's profile"
    })
  })

  it.each([
    [
      { name: 'Anna Nowak', username: 'anna', domain: 'llun.social' },
      'Anna Nowak'
    ],
    [
      { name: '  ', username: 'anna', domain: 'llun.social' },
      '@anna@llun.social'
    ],
    [
      { name: null, username: 'anna', domain: 'llun.social' },
      '@anna@llun.social'
    ],
    [{ username: 'anna', domain: 'llun.social' }, '@anna@llun.social']
  ])('names %o "%s"', (actor, name) => {
    expect(profileName(actor)).toBe(name)
  })
})

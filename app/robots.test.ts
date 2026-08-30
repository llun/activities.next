import robots from './robots'

describe('robots metadata route', () => {
  it('returns valid robots.txt rules allowing public pages and disallowing private/API routes', () => {
    const config = robots()

    expect(config.rules).toBeDefined()
    expect(config.rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: [
        '/account',
        '/admin',
        '/api/',
        '/auth/',
        '/authorize_interaction',
        '/bookmarks',
        '/collections/new',
        '/collections/*/edit',
        '/favorites',
        '/fitness',
        '/health',
        '/inbox',
        '/lists',
        '/messages',
        '/notifications',
        '/oauth/',
        '/search',
        '/settings',
        '/users/'
      ]
    })
  })
})

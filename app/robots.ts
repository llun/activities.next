import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
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
        '/tags',
        '/users/'
      ]
    }
  }
}

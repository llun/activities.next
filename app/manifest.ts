import type { MetadataRoute } from 'next'

import { withVersion } from '@/lib/utils/version'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Activities.next',
    short_name: 'Activities',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: withVersion('/icon-192.png'),
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: withVersion('/icon-512.png'),
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  }
}

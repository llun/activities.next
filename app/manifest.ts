import type { MetadataRoute } from 'next'

import { getDomainDisplayName } from '@/lib/services/domains/domainDisplayName'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { withVersion } from '@/lib/utils/version'

// Named after the domain it is fetched from, so an app installed from a
// served domain carries that domain's name. Reading the request (through
// `headers()`) keeps the route from being prerendered once with one name.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = getDomainDisplayName(await getVisitedDomainIdentity())
  return {
    name,
    short_name: name,
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

import type { MetadataRoute } from 'next'

import { getDomainDisplayName } from '@/lib/services/domains/domainDisplayName'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { withVersion } from '@/lib/utils/version'

// The share sheet's file filter. `image/*` and `video/*` keep Android's intent
// filter matching every gallery provider; the client validates the exact
// subtypes on intake. The fitness entries cover the MIME types a watch or file
// manager sends, plus `application/octet-stream`, which some Android apps use
// for `.gpx`/`.tcx` (accepted by extension on intake).
const SHARE_TARGET_FILE_ACCEPT = [
  'image/*',
  'video/*',
  '.fit',
  '.gpx',
  '.tcx',
  'application/vnd.ant.fit',
  'application/gpx+xml',
  'application/vnd.garmin.tcx+xml',
  'application/octet-stream'
]

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
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: withVersion('/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: withVersion('/icon-maskable-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: withVersion('/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ],
    // The service worker answers this POST on the device (public/sw.js); the
    // server route is only the first-visit fallback.
    share_target: {
      action: '/_share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [
          {
            name: 'files',
            accept: SHARE_TARGET_FILE_ACCEPT
          }
        ]
      }
    },
    shortcuts: [
      {
        name: 'New post',
        short_name: 'New post',
        url: '/app',
        icons: [
          {
            src: withVersion('/icon-192.png'),
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      {
        name: 'Upload activity',
        short_name: 'Upload',
        url: '/fitness/files',
        icons: [
          {
            src: withVersion('/icon-192.png'),
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      {
        name: 'Gallery',
        short_name: 'Gallery',
        url: '/gallery',
        icons: [
          {
            src: withVersion('/icon-192.png'),
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    ]
  }
}

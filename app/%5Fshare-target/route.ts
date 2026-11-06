import { NextRequest } from 'next/server'

import { getContentSecurityPolicyHeader } from '@/lib/utils/http-headers/csp'

// The Web Share Target fallback for `POST /_share-target` (the folder is `%5F`
// because an `_` folder is private and never routed). `public/sw.js` answers
// the share on the device; this is reached only before the worker is installed
// (a first visit). It never reads the body and never stores the files: a
// multipart POST here skips proxy.ts (see its matcher), so Next does not
// buffer the upload either. The reader is sent to the composer, which asks
// them to share again.
export const dynamic = 'force-dynamic'

// Fetch Metadata: a share the OS launches is a browser-initiated navigation
// (`Sec-Fetch-Site: none`). Another site's auto-submitted form is
// `cross-site`/`same-site`; it is sent to /app with no notice. A browser that
// sends no Fetch Metadata is treated as a share.
const isAllowedShare = (request: NextRequest) => {
  const site = request.headers.get('sec-fetch-site')
  const mode = request.headers.get('sec-fetch-mode')
  const dest = request.headers.get('sec-fetch-dest')
  if (mode && mode !== 'navigate') return false
  // A frame another site embeds is a navigation too, but not a share launch.
  if (dest && dest !== 'document') return false
  return !site || site === 'none' || site === 'same-origin'
}

export const POST = (request: NextRequest) => {
  const csp = getContentSecurityPolicyHeader()
  // Relative: the request URL can name the internal host behind a proxy.
  return new Response(null, {
    status: 303,
    headers: {
      Location: isAllowedShare(request) ? '/app?shareUnavailable=1' : '/app',
      'Cache-Control': 'no-store',
      [csp.key]: csp.value
    }
  })
}

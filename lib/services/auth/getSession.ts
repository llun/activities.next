import { headers } from 'next/headers'
import { cache } from 'react'

import { getAuth } from './auth'

// Wrapped in React `cache()` so the better-auth session lookup is deduplicated
// within a single request. Layouts, nested sub-layouts and the page itself all
// resolve the viewer per render; without this each call would re-read the
// session independently.
export const getServerAuthSession = cache(async () => {
  const auth = getAuth()
  const session = await auth.api.getSession({
    headers: await headers()
  })
  return session
})

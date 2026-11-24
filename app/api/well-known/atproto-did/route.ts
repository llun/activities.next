import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getServedAuthority } from '@/lib/utils/host'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

// GET /.well-known/atproto-did — atproto handle verification over HTTPS. A
// served domain answers only when an admin's actor on it claimed it in
// Settings › Other networks, so that actor can use the domain as a Bluesky
// handle.
export const GET = traceApiRoute('atprotoDid', async (req: NextRequest) => {
  const database = getDatabase()
  const account = database
    ? await database.getBlueskyAccountByInstanceHandle({
        // The served host, or the primary one for an untrusted Host (a
        // proxy's internal name): the DID is public, and a verifier always
        // asks with the real name.
        host: getServedAuthority(headerHost(req.headers)) ?? ''
      })
    : null
  return new Response(account ? account.did : 'Not Found', {
    status: account ? 200 : 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
})

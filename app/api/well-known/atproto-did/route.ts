import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getDomainCheckRequestHost } from '@/lib/services/domains/domainCheck'
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
        // The authority the request arrived on, never the primary-host
        // fallback headerHost() uses, so an IP or a stranger's name gets 404.
        host: getDomainCheckRequestHost(req.headers)
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

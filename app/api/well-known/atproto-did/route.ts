import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

// GET /.well-known/atproto-did — atproto handle verification over HTTPS. A
// host answers only when an admin's actor claimed it in Settings › Other
// networks, so that actor can use the server's name as a Bluesky handle.
export const GET = traceApiRoute('atprotoDid', async (req: NextRequest) => {
  const database = getDatabase()
  const account = database
    ? await database.getBlueskyAccountByInstanceHandle({
        host: headerHost(req.headers)
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

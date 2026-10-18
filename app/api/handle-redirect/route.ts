import { NextRequest } from 'next/server'

import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS = [HttpMethod.enum.GET, HttpMethod.enum.HEAD]

// `/@user` (and `/@user/<status>`, `/@user/followers`, …) on a host the env does
// not list. `proxy.ts` rewrites those here because it cannot read the
// `domains` table: this answers with a RELATIVE redirect to the full
// `/@user@<domain>` path, where the domain is `headerHost` — the visited host
// when it is an active Admin › Domains row, the primary host otherwise (what
// the proxy itself does for every other untrusted host). The request's host is
// never echoed unless it is one of ours.
const BARE_HANDLE_PATH = /^\/@(\w+)((?:\/[^@?#]*)?)$/

export const GET = traceApiRoute(
  'bareHandleRedirect',
  async (req: NextRequest) => {
    const url = new URL(req.url)
    const path = url.searchParams.get('path') ?? ''
    const query = url.searchParams.get('query') ?? ''
    const match = BARE_HANDLE_PATH.exec(path)
    if (!match || (query && !query.startsWith('?'))) {
      return apiResponse({
        req,
        allowedMethods: ALLOWED_METHODS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    await ensureServedDomainsFresh()
    const [, username, rest] = match
    const location = `/@${username}@${headerHost(req.headers)}${rest}${query}`
    return new Response(null, {
      status: 307,
      headers: { Location: location, 'Cache-Control': 'no-store' }
    })
  }
)

export const HEAD = GET

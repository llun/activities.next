import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getPdsSubdomainHandle } from '@/lib/services/pds/host'
import { getServedAuthority } from '@/lib/utils/host'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const didResponse = (did: string) =>
  new Response(did, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })

const notFound = () =>
  new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })

// GET /.well-known/atproto-did — atproto handle verification over HTTPS.
//
// A `<username>.<PDS hostname>` host answers the DID of that username's active
// hosted repo when its handle is exactly that host. A served domain answers
// only when an admin's actor on it claimed it in Settings › Other networks, so
// that actor can use the domain as a Bluesky handle; when that actor also has
// an active hosted repo, the repo's DID wins (the two cannot both exist).
export const GET = traceApiRoute('atprotoDid', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) return notFound()

  const subdomain = getPdsSubdomainHandle(req.headers)
  if (subdomain) {
    const actor = await database.getActorFromUsername({
      username: subdomain.username,
      domain: subdomain.domain
    })
    if (actor) {
      const repo = await database.getPdsRepo({ actorId: actor.id })
      if (
        repo &&
        repo.status === 'active' &&
        repo.handle === subdomain.handle
      ) {
        return didResponse(repo.did)
      }
    }
  }

  const account = await database.getBlueskyAccountByInstanceHandle({
    // The served host, or the primary one for an untrusted Host (a proxy's
    // internal name): the DID is public, and a verifier always asks with the
    // real name.
    host: getServedAuthority(headerHost(req.headers)) ?? ''
  })
  if (!account) return notFound()

  const repo = await database.getPdsRepo({ actorId: account.actorId })
  if (repo && repo.status === 'active') return didResponse(repo.did)
  return didResponse(account.did)
})

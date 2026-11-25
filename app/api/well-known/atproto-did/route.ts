import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { resolveEffectivePdsRepoStatus } from '@/lib/services/pds/effectiveStatus'
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
// A `<username>.<PDS hostname>` host (never one that is a served domain or
// another PDS hostname) or a served domain answers the DID of the live hosted
// repo whose handle is that host, while the repo's effective status is active
// (a suspended, disabled, unapproved or deleting actor's repo is not
// answered). Otherwise a served domain answers when an admin's actor on it
// claimed it for a linked account in Settings › Other networks.
export const GET = traceApiRoute('atprotoDid', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) return notFound()

  // The served host, or the primary one for an untrusted Host (a proxy's
  // internal name): the DID is public, and a verifier always asks with the
  // real name.
  const servedHost = getServedAuthority(headerHost(req.headers)) ?? ''
  const handle = getPdsSubdomainHandle(req.headers)?.handle ?? servedHost
  const repo = handle ? await database.getPdsRepoByHandle({ handle }) : null
  if (repo) {
    const actor = await database.getActorFromId({ id: repo.actorId })
    if (resolveEffectivePdsRepoStatus(repo, actor) === 'active') {
      return didResponse(repo.did)
    }
  }

  const account = await database.getBlueskyAccountByInstanceHandle({
    host: servedHost
  })
  return account ? didResponse(account.did) : notFound()
})

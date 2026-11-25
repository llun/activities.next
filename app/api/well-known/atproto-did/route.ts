import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import type { PdsRepo } from '@/lib/database/domains/pds/types'
import { isServedDomainSnapshotFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { resolveEffectivePdsRepoStatus } from '@/lib/services/pds/effectiveStatus'
import {
  getPdsRequestHost,
  getPdsSubdomainHandle,
  isPdsSubdomainHost
} from '@/lib/services/pds/host'
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
// another PDS hostname) answers the DID of the live hosted repo whose handle
// is that host, while its effective status is active, and 404 otherwise. Any
// other host below a configured PDS hostname answers 404, including while the
// served-domain snapshot is not fresh and the subdomain is not parsed.
//
// A served domain is decided by the live hosted repo holding it as its handle
// when that repo's actor may still hold the domain (an active admin's actor on
// it, the rule a linked account's claim follows): its DID while it is
// effectively active, 404 otherwise. A holder that lost eligibility is passed
// over. While the snapshot is not fresh, so is every hosted repo for a request
// whose own host is not the one served (an untrusted Host falls back to the
// primary host). Then the linked account that claimed the domain in
// Settings › Other networks answers, if any.
export const GET = traceApiRoute('atprotoDid', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) return notFound()

  const answerHosted = async (repo: PdsRepo) => {
    const actor = await database.getActorFromId({ id: repo.actorId })
    return resolveEffectivePdsRepoStatus(repo, actor) === 'active'
      ? didResponse(repo.did)
      : notFound()
  }

  // Fails closed itself while the snapshot is not fresh.
  const subdomain = getPdsSubdomainHandle(req.headers)
  if (subdomain) {
    const repo = await database.getPdsRepoByHandle({
      handle: subdomain.handle
    })
    return repo ? answerHosted(repo) : notFound()
  }
  if (isPdsSubdomainHost(req.headers)) return notFound()

  // The served host, or the primary one for an untrusted Host (a proxy's
  // internal name): the DID is public, and a verifier always asks with the
  // real name.
  const servedHost = getServedAuthority(headerHost(req.headers)) ?? ''
  const ownHost = getServedAuthority(getPdsRequestHost(req.headers))
  if (servedHost && (isServedDomainSnapshotFresh() || servedHost === ownHost)) {
    const repo = await database.getPdsRepoByHandle({ handle: servedHost })
    if (
      repo &&
      (await database.isEligibleInstanceHandleHolder({
        actorId: repo.actorId,
        host: servedHost
      }))
    ) {
      return answerHosted(repo)
    }
  }

  const account = await database.getBlueskyAccountByInstanceHandle({
    host: servedHost
  })
  return account ? didResponse(account.did) : notFound()
})

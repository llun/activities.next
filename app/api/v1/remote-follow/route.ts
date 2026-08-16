import { z } from 'zod'

import { getWebfingerSubscribeTemplate } from '@/lib/activities/getWebfingerDocument'
import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { parseAccountHandle, stripAcctPrefix } from '@/lib/utils/accountHandle'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS = [HttpMethod.enum.GET]

// Longest sensible address; also the cap on the URL this route hands back.
const MAX_ACCOUNT_LENGTH = 320
const MAX_RESULT_URL_LENGTH = 2048

const RemoteFollowQuery = z.object({
  // The visitor's own account: `user@domain`, `@user@domain`, `acct:user@domain`
  // or a bare `domain`.
  account: z.string().trim().min(1).max(MAX_ACCOUNT_LENGTH),
  // The local account they want to follow, as `user@domain`.
  target: z.string().trim().min(1).max(MAX_ACCOUNT_LENGTH)
})

// Conservative superset of what fediverse software allows in a local
// username. The visitor's username goes straight into an outbound `acct:`
// resource, so anything outside this set (`user:pass`, a slash, a control
// character) is rejected rather than looked up.
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/

const buildFallbackTemplate = (domain: string) =>
  `https://${domain}/authorize_interaction?uri={uri}`

// Accepts a bare hostname only — no credentials, path, query or fragment — so
// the domain that ends up in the redirect cannot smuggle anything else in.
const parseBareDomain = (value: string): string | null => {
  try {
    const url = new URL(`https://${value}`)
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.hostname.includes('.')
    ) {
      return null
    }
    return url.host
  } catch {
    return null
  }
}

const isUsableRedirectUrl = (value: string) => {
  if (value.length > MAX_RESULT_URL_LENGTH) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * Resolves where to send a logged-out visitor so they can follow a local
 * account from their own server — the outbound half of the fediverse
 * remote-follow handshake.
 *
 * Deliberately unauthenticated: the whole feature exists for visitors with no
 * account here. It is a read-only GET that changes no state, and the abuse
 * surface (one outbound WebFinger request to a user-supplied domain) is bounded
 * by strict syntax validation, the instance's federation policy, the
 * retry-disabled request helper's timeouts and body cap, and the requirement
 * that `target` name an actor this server actually hosts — so it cannot be
 * repurposed into a general-purpose URL builder or redirector for third
 * parties. This instance has no inbound rate-limit layer; operators should
 * rate-limit at the reverse proxy.
 */
export const GET = traceApiRoute('remoteFollow', async (req) => {
  const database = getDatabase()
  if (!database) return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)

  const query = RemoteFollowQuery.safeParse(
    Object.fromEntries(new URL(req.url).searchParams)
  )
  if (!query.success) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

  // The followed account must be one of ours. This is what keeps the endpoint
  // from building arbitrary third-party URLs.
  const targetHandle = parseAccountHandle(stripAcctPrefix(query.data.target))
  if (!targetHandle) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

  const targetActor = await database.getActorFromUsername({
    username: targetHandle.username,
    domain: targetHandle.domain
  })
  if (!targetActor?.privateKey) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

  const account = stripAcctPrefix(query.data.account)
  const visitorHandle = account.includes('@')
    ? parseAccountHandle(account)
    : null
  if (visitorHandle && !USERNAME_PATTERN.test(visitorHandle.username)) {
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  // Both forms go through parseBareDomain, so a handle's domain is held to the
  // same bare-hostname rule as the domain-only form — and both come back in the
  // parser's normalized form, which is what makes an internationalized domain
  // usable: the URL parser punycodes `bücher.test` to `xn--bcher-kva.test`,
  // matching what the remote server actually serves and what its `acct:`
  // resource is spelled with.
  const visitorDomain = parseBareDomain(
    visitorHandle ? visitorHandle.domain : account
  )
  if (!visitorDomain) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

  if (!(await canFederateWithDomain(database, visitorDomain))) {
    return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
  }

  // A bare domain has no account to look up, so go straight to the
  // conventional path. Any lookup failure degrades to the same fallback rather
  // than failing the request — Mastodon behaves identically.
  const advertisedTemplate = visitorHandle
    ? await getWebfingerSubscribeTemplate({
        account: `${visitorHandle.username}@${visitorDomain}`
      })
    : null

  const fallbackTemplate = buildFallbackTemplate(visitorDomain)
  const template =
    advertisedTemplate && advertisedTemplate.includes('{uri}')
      ? advertisedTemplate
      : fallbackTemplate

  // Substitute the bare acct rather than a profile URL: it is what the
  // receiving server WebFingers, so it resolves regardless of that server's
  // content negotiation or which alias domain served this page.
  const targetAcct = `${targetActor.username}@${targetActor.domain}`
  const url = template.replace('{uri}', encodeURIComponent(targetAcct))

  return apiResponse({
    req,
    allowedMethods: ALLOWED_METHODS,
    data: {
      url: isUsableRedirectUrl(url)
        ? url
        : fallbackTemplate.replace('{uri}', encodeURIComponent(targetAcct))
    }
  })
})

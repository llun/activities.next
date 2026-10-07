import { getWebfingerDocument } from '@/lib/activities/getWebfingerDocument'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { WebFinger } from '@/lib/types/activitypub/webfinger'
import { normalizeActivityPubUri } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

export type ConfirmedActorHandle = {
  username: string
  domain: string
}

// A handle's username part. Stored verbatim (remote servers choose their own
// casing) and later spliced into `/@user@domain` paths and `acct:` URIs, so
// anything that would change how those split is refused.
const ACCT_USERNAME_PATTERN = /^[^\s@/\\:?#]+$/

// `user@domain` (an `acct:` prefix allowed), with the domain reduced to what
// `new URL().host` would store: lowercase, port kept, no path or userinfo.
const parseAcct = (
  value: string | null | undefined
): ConfirmedActorHandle | null => {
  if (!value) return null
  const [username, domain, ...rest] = value.replace(/^acct:/i, '').split('@')
  if (!username || !domain || rest.length > 0) return null
  if (!ACCT_USERNAME_PATTERN.test(username)) return null
  if (!URL.canParse(`https://${domain}`)) return null
  const { host, pathname, search, hash } = new URL(`https://${domain}`)
  if (host !== domain.toLowerCase() || pathname !== '/' || search || hash) {
    return null
  }
  return { username, domain: host }
}

const sameHandle = (left: ConfirmedActorHandle, right: ConfirmedActorHandle) =>
  left.username.toLowerCase() === right.username.toLowerCase() &&
  left.domain === right.domain

const getSelfHrefs = (document: WebFinger | null) =>
  document?.links.flatMap((link) =>
    link.rel === 'self' && 'href' in link ? [link.href] : []
  ) ?? []

// An actor document names its own handle: `preferredUsername` plus the host of
// its `id`. Serving it from that host proves only that the host served SOME
// document — any URL there can claim any username on it (a JSON upload on a
// Pleroma/Akkoma media path, for one). Before a remote actor row is created,
// ask WebFinger who the handle is: its `self` link must name this very actor
// id. Mastodon does the same before it records an account.
//
// The first question goes to the host of the actor id, for
// `preferredUsername@<actor host>`. A split-domain deployment (handle on
// `example.com`, actors on `social.example.com`) confirms there: Mastodon,
// GoToSocial, Pleroma/Akkoma and this server all answer for `user@<actor
// host>` too, and the row keeps the actor host as its domain, as it always
// has.
//
// When the actor host does not confirm but answers with a `subject` naming
// another handle, that handle gets one question, like Mastodon's `subject`
// redirect: its domain must name the same handle as its `subject` and this
// actor id as `self`, and the returned handle is THAT one — the caller stores
// it, so the row never carries a username on the actor host that the actor
// host did not vouch for. The redirect is the actor host's own answer, so a
// document the host merely serves cannot steer it. An actor document's
// FEP-2c59 `webfinger` property is deliberately NOT followed: it is chosen by
// the document, so an upload the host serves as ActivityPub could name an
// attacker's domain, be confirmed there, and then sign — and pass every
// same-origin check — as a URL on the host that served it. The redirected
// domain is still checked against the federation policy before it is asked.
export const confirmActorHandle = async ({
  database,
  actorId,
  username,
  withNetworkRetry = true,
  responseTimeout,
  allowCrossHostRedirects
}: {
  database: Database
  actorId: string
  username: string
  withNetworkRetry?: boolean
  responseTimeout?: number
  allowCrossHostRedirects?: boolean
}): Promise<ConfirmedActorHandle | null> => {
  const host = URL.canParse(actorId) ? new URL(actorId).host : ''
  if (!host) return null
  const expectedId = normalizeActivityPubUri(actorId)
  const lookup = (
    handle: ConfirmedActorHandle,
    followCrossHostRedirects = allowCrossHostRedirects
  ) =>
    getWebfingerDocument({
      account: `${handle.username}@${handle.domain}`,
      withNetworkRetry,
      responseTimeout,
      allowCrossHostRedirects: followCrossHostRedirects
    })
  const namesActor = (document: WebFinger | null) =>
    getSelfHrefs(document).some(
      (href) => normalizeActivityPubUri(href) === expectedId
    )

  const hostHandle = { username, domain: host }
  const hostDocument = await lookup(hostHandle)
  if (namesActor(hostDocument)) return hostHandle

  const handle = parseAcct(hostDocument?.subject)
  const canAskHandleDomain =
    handle !== null &&
    !sameHandle(handle, hostHandle) &&
    (await canFederateWithDomain(database, `https://${handle.domain}`))
  // Never across hosts: the domain was checked against the federation policy,
  // and a redirect would reach one that was not.
  const handleDocument =
    handle && canAskHandleDomain ? await lookup(handle, false) : null
  const handleSubject = parseAcct(handleDocument?.subject)
  if (
    handle &&
    handleSubject &&
    sameHandle(handleSubject, handle) &&
    namesActor(handleDocument)
  ) {
    return handleSubject
  }

  logger.warn({
    message: 'Refused remote actor whose handle WebFinger does not confirm',
    actorId,
    account: `${username}@${host}`,
    // The host chooses these strings; a few are enough to diagnose.
    webfingerSelf: hostDocument ? getSelfHrefs(hostDocument).slice(0, 5) : null,
    handleDomainAccount: handle ? `${handle.username}@${handle.domain}` : null,
    handleDomainAsked: canAskHandleDomain
  })
  return null
}

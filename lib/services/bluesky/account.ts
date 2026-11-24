import {
  OAuthResolverError,
  extractPdsUrl,
  isAtprotoDid
} from '@atproto/oauth-client-node'
import crypto from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'

import { getConfig } from '@/lib/config'
import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import {
  BLUESKY_APP_PASSWORD_PATTERN,
  type BlueskyAccountState,
  type BlueskyHandleCheck,
  getBlueskyDnsRecord
} from '@/lib/utils/blueskyAccount'
import { getServedAuthority } from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  BLUESKY_OAUTH_SCOPE,
  createBlueskyIdentityResolver,
  getBlueskyOAuthClient,
  writeStoredBlueskySession
} from './client'

const INVALID_HANDLE = 'handle.invalid'

// The `scope` claim of a PDS access token, read without verifying it: the
// PDS that issued it was just asked over HTTPS, and the token is only stored.
const getJwtScope = (jwt: string): string => {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')
    )
    const scope = (payload as { scope?: unknown })?.scope
    return typeof scope === 'string' ? scope : ''
  } catch {
    return ''
  }
}

export class BlueskyLinkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 422 | 429 | 502 = 422
  ) {
    super(message)
  }
}

const HANDLE_PATTERN =
  /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}$/
const isHandle = (value: string) =>
  value.length <= 253 && HANDLE_PATTERN.test(value)

// Each of these reaches other servers on the actor's behalf (and app-password
// tries are guesses against the PDS), so they share one window per actor.
const RATE_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 }

const limitOutboundAction = async (database: Database, actor: Actor) => {
  const digest = crypto.createHash('sha256').update(actor.id).digest('hex')
  const result = await database.consumeRateLimit({
    key: `${APP_RATE_LIMIT_KEY_PREFIX}bluesky:${digest}`,
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    ...RATE_LIMIT
  })
  if (!result.allowed) {
    throw new BlueskyLinkError(
      `Too many tries. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minutes.`,
      429
    )
  }
}

// Handles and DIDs only: never a URL, so the resolver cannot be pointed at an
// arbitrary host through this input.
const normalizeIdentifier = (input: string) => {
  const value = input.trim().replace(/^@/, '').toLowerCase()
  if (isAtprotoDid(value)) return value
  if (isHandle(value)) return value
  throw new BlueskyLinkError('Enter a Bluesky handle, like alice.bsky.social.')
}

// The served domain the actor lives on: the host it may answer
// /.well-known/atproto-did for. A handle carries no port, so a host with one
// cannot be claimed.
const getClaimableHost = (actor: Actor) => {
  const host = getServedAuthority(actor.domain)
  return !host || host.includes(':') ? null : host
}

// A handle needs its own DNS record unless it sits under a domain the PDS
// hands out (".bsky.social" on Bluesky's). When the PDS does not say, show the
// record: extra help is better than none.
const isDomainHandle = async (handle: string, pdsUrl: string) => {
  if (handle === INVALID_HANDLE) return true
  try {
    const response = await safeRemoteFetch({
      url: new URL('/xrpc/com.atproto.server.describeServer', pdsUrl).href,
      maxRedirects: 0,
      maxBodyBytes: 64 * 1024,
      timeoutInMilliseconds: 5000
    })
    if (response.statusCode !== 200) {
      logger.info({
        message: 'Bluesky describeServer failed; showing the DNS record',
        pdsUrl,
        statusCode: response.statusCode
      })
      return true
    }
    const domains: unknown = JSON.parse(response.body).availableUserDomains
    if (!Array.isArray(domains)) return true
    return !domains.some(
      (domain) =>
        typeof domain === 'string' &&
        domain.startsWith('.') &&
        handle.endsWith(domain.toLowerCase())
    )
  } catch (error) {
    logger.info({
      message: 'Bluesky describeServer failed; showing the DNS record',
      pdsUrl,
      err: toLoggableError(error)
    })
    return true
  }
}

const resolveIdentity = async (identifier: string, noCache = false) => {
  try {
    const identity = await createBlueskyIdentityResolver().resolve(identifier, {
      noCache
    })
    // An unverified handle comes back as handle.invalid; keep the one the DID
    // document claims, so the DNS row names the domain to fix.
    const claimed = identity.didDoc.alsoKnownAs
      ?.find((name) => name.startsWith('at://'))
      ?.slice('at://'.length)
      .toLowerCase()
    const verified = identity.handle !== INVALID_HANDLE
    return {
      did: identity.did,
      handle: verified
        ? identity.handle
        : claimed && isHandle(claimed)
          ? claimed
          : INVALID_HANDLE,
      verified,
      pdsUrl: extractPdsUrl(identity.didDoc).href
    }
  } catch (error) {
    logger.info({
      message: 'Bluesky identity did not resolve',
      err: toLoggableError(error)
    })
    throw new BlueskyLinkError(
      'That Bluesky account could not be found. Check the handle and try again.'
    )
  }
}

export const getBlueskyAccountState = async (
  database: Database,
  actor: Actor
): Promise<BlueskyAccountState> => {
  const account = await database.getBlueskyAccount({ actorId: actor.id })
  const session = account
    ? await database.getBlueskySession({ did: account.did })
    : null
  const host = getClaimableHost(actor)
  let instanceHandle: BlueskyAccountState['instanceHandle'] = null
  if (actor.account?.role === 'admin' && host) {
    const holder = await database.getBlueskyAccountByInstanceHandle({ host })
    instanceHandle = {
      host,
      status: !holder ? 'free' : holder.actorId === actor.id ? 'yours' : 'taken'
    }
  }
  return {
    oauthAvailable: Boolean(getConfig().bluesky),
    account: account
      ? {
          did: account.did,
          handle: account.handle,
          pdsUrl: account.pdsUrl,
          authType: account.authType,
          domainHandle: account.domainHandle,
          sessionActive: Boolean(session)
        }
      : null,
    instanceHandle
  }
}

/**
 * Returns the authorization URL to send the browser to. `requestHost` is the
 * served host the request arrived on.
 */
export const startBlueskyOAuth = async (
  database: Database,
  actor: Actor,
  input: string,
  requestHost?: string
): Promise<string> => {
  // Sign-in returns to the actor's own domain, where the session cookie must
  // be; one started on another served domain could not finish.
  const domain = getServedAuthority(actor.domain) ?? actor.domain
  if (requestHost !== undefined && requestHost !== domain) {
    throw new BlueskyLinkError(
      `Open Settings on ${domain} to sign in with Bluesky, or use an app password.`,
      400
    )
  }
  const client = getBlueskyOAuthClient(database, actor.domain)
  if (!client) {
    throw new BlueskyLinkError(
      'Bluesky sign-in is not set up on this server. Use an app password.',
      400
    )
  }
  // Refuse a DID another profile holds before the authorization server is
  // involved: finishing the sign-in would make the OAuth client revoke and
  // replace that profile's stored session. (A user who signs in as another
  // account on the authorization server still gets past this; the callback
  // refuses the link, and readers trust a stored session's own `type`.)
  const identifier = normalizeIdentifier(input)
  await limitOutboundAction(database, actor)
  const { did } = await resolveIdentity(identifier)
  const holder = await database.getBlueskyAccountByDid({ did })
  if (holder && holder.actorId !== actor.id) {
    throw new BlueskyLinkError(
      'This Bluesky account is already linked to another profile on this server.',
      409
    )
  }
  // Outside the try: a key that will not load is our fault, not the PDS's.
  const oauthClient = await client
  let url: URL
  try {
    url = await oauthClient.authorize(did, {
      scope: BLUESKY_OAUTH_SCOPE,
      // Read back in the callback, which refuses another actor's sign-in.
      state: actor.id
    })
  } catch (error) {
    // The account's servers had no usable sign-in for us (no OAuth metadata,
    // an auth method or scope we can't use, a PAR refusal or outage). Only a
    // failure to find them is routine; the rest needs a look, but the user's
    // way forward is the same: an app password.
    const log = error instanceof OAuthResolverError ? logger.info : logger.warn
    log({
      message: 'Bluesky OAuth could not start',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    throw new BlueskyLinkError(
      'Bluesky sign-in could not start for that account’s server. Try again later, or use an app password.',
      502
    )
  }
  // The browser goes there next; only ever to an HTTPS sign-in page.
  if (url.protocol !== 'https:') {
    throw new BlueskyLinkError(
      'That account’s sign-in page is not secure. Use an app password.',
      502
    )
  }
  return url.href
}

const saveLink = async (
  database: Database,
  actor: Actor,
  identity: { did: string; handle: string; pdsUrl: string },
  authType: 'oauth' | 'app_password'
) => {
  const result = await database.saveBlueskyAccount({
    actorId: actor.id,
    did: identity.did,
    handle: identity.handle,
    pdsUrl: identity.pdsUrl,
    authType,
    domainHandle: await isDomainHandle(identity.handle, identity.pdsUrl)
  })
  if (result === 'did_taken') {
    throw new BlueskyLinkError(
      'This Bluesky account is already linked to another profile on this server.',
      409
    )
  }
}

export type BlueskyCallbackResult = 'linked' | 'did_taken' | 'failed'

export const completeBlueskyOAuth = async (
  database: Database,
  actor: Actor,
  params: URLSearchParams
): Promise<BlueskyCallbackResult> => {
  const client = getBlueskyOAuthClient(database, actor.domain)
  if (!client) return 'failed'
  // The callback stores a session for the DID before we decide; on any
  // outcome but a link, drop it unless a link uses the DID.
  const dropUnlinkedSession = async (did: string) => {
    if (!(await database.getBlueskyAccountByDid({ did }))) {
      await database.deleteBlueskySession({ did })
    }
  }
  let result: { session: { did: string }; state?: string | null }
  try {
    result = await (await client).callback(params)
  } catch (error) {
    // `error=` in the redirect is the user (or their server) declining;
    // anything else is a failure on our side or theirs that needs a look.
    const log = params.has('error') ? logger.info : logger.warn
    log({
      message: 'Bluesky OAuth callback failed',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    return 'failed'
  }
  const did = result.session.did
  // The state was minted for one actor. Finishing it as another one (a forged
  // or shared callback link) would link a stranger's Bluesky account.
  if (result.state !== actor.id) {
    logger.warn({
      message: 'Bluesky OAuth callback for another actor refused',
      actorId: actor.id
    })
    await dropUnlinkedSession(did)
    return 'failed'
  }

  try {
    await saveLink(database, actor, await resolveIdentity(did, true), 'oauth')
    return 'linked'
  } catch (error) {
    const taken = error instanceof BlueskyLinkError && error.status === 409
    if (!taken) {
      logger.error({
        message: 'Bluesky OAuth link could not be saved',
        actorId: actor.id,
        err: toLoggableError(error)
      })
    }
    await dropUnlinkedSession(did)
    return taken ? 'did_taken' : 'failed'
  }
}

export const linkBlueskyAppPassword = async (
  database: Database,
  actor: Actor,
  input: { identifier: string; password: string }
) => {
  // Only the app-password shape: a main password must never be stored.
  if (!BLUESKY_APP_PASSWORD_PATTERN.test(input.password.trim())) {
    throw new BlueskyLinkError(
      'Use an app password, like abcd-efgh-ijkl-mnop, not your main password.'
    )
  }
  const identifier = normalizeIdentifier(input.identifier)
  await limitOutboundAction(database, actor)
  const identity = await resolveIdentity(identifier)
  let body: {
    did?: unknown
    accessJwt?: unknown
    refreshJwt?: unknown
  }
  let statusCode: number
  try {
    const response = await safeRemoteFetch({
      url: new URL('/xrpc/com.atproto.server.createSession', identity.pdsUrl)
        .href,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: identity.did,
        password: input.password.trim()
      }),
      maxRedirects: 0,
      maxBodyBytes: 64 * 1024
    })
    statusCode = response.statusCode
    body = statusCode === 200 ? JSON.parse(response.body) : {}
  } catch (error) {
    logger.info({
      message: 'Bluesky app password sign-in failed',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    throw new BlueskyLinkError(
      'The Bluesky server could not be reached. Try again later.',
      502
    )
  }
  if (statusCode === 401 || statusCode === 400) {
    throw new BlueskyLinkError('The handle or app password is wrong.')
  }
  if (
    statusCode !== 200 ||
    body.did !== identity.did ||
    typeof body.accessJwt !== 'string' ||
    typeof body.refreshJwt !== 'string'
  ) {
    throw new BlueskyLinkError(
      'The Bluesky server gave an unexpected answer. Try again later.',
      502
    )
  }
  // A main password in the app-password shape would sign in with full
  // access; only an app-password session (scope com.atproto.appPass…) is kept.
  if (!getJwtScope(body.accessJwt).startsWith('com.atproto.appPass')) {
    throw new BlueskyLinkError(
      'Use an app password, like abcd-efgh-ijkl-mnop, not your main password.'
    )
  }
  await saveLink(database, actor, identity, 'app_password')
  await writeStoredBlueskySession(database, identity.did, {
    type: 'app_password',
    accessJwt: body.accessJwt,
    refreshJwt: body.refreshJwt
  })
}

// Removes the link and the stored session only: the Bluesky account itself,
// and any session the PDS still lists, are the user's to manage there.
export const unlinkBluesky = (database: Database, actor: Actor) =>
  database.deleteBlueskyAccount({ actorId: actor.id })

const DNS_NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA'])

// null when DNS could not answer (a timeout, a failing server): that is not
// the same as a missing record.
const hasDnsRecord = async (
  handle: string,
  did: string
): Promise<boolean | null> => {
  const { name, value } = getBlueskyDnsRecord(handle, did)
  try {
    return (await resolveTxt(name)).some((chunks) => chunks.join('') === value)
  } catch (error) {
    if (DNS_NOT_FOUND.has((error as NodeJS.ErrnoException).code ?? '')) {
      return false
    }
    logger.warn({
      message: 'Bluesky handle DNS lookup failed',
      name,
      err: toLoggableError(error)
    })
    return null
  }
}

export const checkBlueskyHandle = async (
  database: Database,
  actor: Actor
): Promise<BlueskyHandleCheck> => {
  const account = await database.getBlueskyAccount({ actorId: actor.id })
  if (!account) throw new BlueskyLinkError('No Bluesky account is linked.', 400)
  await limitOutboundAction(database, actor)
  const identity = await resolveIdentity(account.did, true)
  const { handle, verified } = identity
  await database.updateBlueskyAccountIdentity({
    actorId: actor.id,
    handle,
    pdsUrl: identity.pdsUrl,
    domainHandle: await isDomainHandle(handle, identity.pdsUrl)
  })
  return {
    handle,
    verified,
    dnsRecord: await hasDnsRecord(handle, account.did)
  }
}

export const setBlueskyInstanceHandle = async (
  database: Database,
  actor: Actor,
  enabled: boolean
) => {
  // Anyone may let go of a claim (an admin who lost the role included); only
  // an admin may take one.
  if (!enabled) {
    await database.setBlueskyInstanceHandle({ actorId: actor.id, host: null })
    return
  }
  if (actor.account?.role !== 'admin') {
    throw new BlueskyLinkError('Only an admin can use this server’s name.', 400)
  }
  const host = getClaimableHost(actor)
  if (!host) {
    throw new BlueskyLinkError('This server’s address cannot be a handle.', 400)
  }
  if (!(await database.getBlueskyAccount({ actorId: actor.id }))) {
    throw new BlueskyLinkError('Link a Bluesky account first.', 400)
  }
  const saved = await database.setBlueskyInstanceHandle({
    actorId: actor.id,
    host
  })
  if (!saved) {
    throw new BlueskyLinkError(
      `Another profile already answers for ${host}.`,
      409
    )
  }
}

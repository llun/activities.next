import { extractPdsUrl, isAtprotoDid } from '@atproto/oauth-client-node'
import { resolveTxt } from 'node:dns/promises'

import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import {
  BLUESKY_APP_PASSWORD_PATTERN,
  type BlueskyAccountState,
  type BlueskyHandleCheck,
  getBlueskyDnsRecord
} from '@/lib/utils/blueskyAccount'
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

export class BlueskyLinkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 422 | 502 = 422
  ) {
    super(message)
  }
}

// Handles and DIDs only: never a URL, so the resolver cannot be pointed at an
// arbitrary host through this input.
const normalizeIdentifier = (input: string) => {
  const value = input.trim().replace(/^@/, '').toLowerCase()
  if (isAtprotoDid(value)) return value
  if (
    /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}$/.test(value)
  ) {
    return value
  }
  throw new BlueskyLinkError('Enter a Bluesky handle, like alice.bsky.social.')
}

const getInstanceHost = () => getConfig().host.toLowerCase()

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
    if (response.statusCode !== 200) return true
    const domains: unknown = JSON.parse(response.body).availableUserDomains
    if (!Array.isArray(domains)) return true
    return !domains.some(
      (domain) =>
        typeof domain === 'string' &&
        domain.startsWith('.') &&
        handle.endsWith(domain.toLowerCase())
    )
  } catch {
    return true
  }
}

const resolveIdentity = async (identifier: string, noCache = false) => {
  try {
    const identity = await createBlueskyIdentityResolver().resolve(identifier, {
      noCache
    })
    return {
      did: identity.did,
      handle: identity.handle,
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
  const host = getInstanceHost()
  let instanceHandle: BlueskyAccountState['instanceHandle'] = null
  // A handle carries no port, so a host with one cannot be claimed.
  if (actor.account?.role === 'admin' && !host.includes(':')) {
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

/** Returns the authorization URL to send the browser to. */
export const startBlueskyOAuth = async (
  database: Database,
  actor: Actor,
  input: string
): Promise<string> => {
  const client = getBlueskyOAuthClient(database)
  if (!client) {
    throw new BlueskyLinkError(
      'Bluesky sign-in is not set up on this server. Use an app password.',
      400
    )
  }
  const identifier = normalizeIdentifier(input)
  try {
    const url = await (
      await client
    ).authorize(identifier, {
      scope: BLUESKY_OAUTH_SCOPE,
      // Read back in the callback, which refuses another actor's sign-in.
      state: actor.id
    })
    return url.href
  } catch (error) {
    logger.info({
      message: 'Bluesky OAuth could not start',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    throw new BlueskyLinkError(
      'That account’s server does not offer Bluesky sign-in. Use an app password instead.',
      502
    )
  }
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
  const client = getBlueskyOAuthClient(database)
  if (!client) return 'failed'
  let did: string
  try {
    const { session, state } = await (await client).callback(params)
    did = session.did
    // The state was minted for one actor. Finishing it as another one (a
    // forged or shared callback link) would link a stranger's Bluesky account.
    if (state !== actor.id) {
      logger.warn({
        message: 'Bluesky OAuth callback for another actor refused',
        actorId: actor.id
      })
      // The callback already stored the session; keep it only when it is
      // the session of an existing link.
      if (!(await database.getBlueskyAccountByDid({ did }))) {
        await database.deleteBlueskySession({ did })
      }
      return 'failed'
    }
  } catch (error) {
    logger.info({
      message: 'Bluesky OAuth callback failed',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    return 'failed'
  }

  try {
    await saveLink(database, actor, await resolveIdentity(did, true), 'oauth')
    return 'linked'
  } catch (error) {
    if (error instanceof BlueskyLinkError && error.status === 409) {
      return 'did_taken'
    }
    logger.error({
      message: 'Bluesky OAuth link could not be saved',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    return 'failed'
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
  const identity = await resolveIdentity(normalizeIdentifier(input.identifier))
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

const hasDnsRecord = async (handle: string, did: string) => {
  const { name, value } = getBlueskyDnsRecord(handle, did)
  try {
    return (await resolveTxt(name)).some((chunks) => chunks.join('') === value)
  } catch {
    return false
  }
}

export const checkBlueskyHandle = async (
  database: Database,
  actor: Actor
): Promise<BlueskyHandleCheck> => {
  const account = await database.getBlueskyAccount({ actorId: actor.id })
  if (!account) throw new BlueskyLinkError('No Bluesky account is linked.', 400)
  const identity = await resolveIdentity(account.did, true)
  const verified = identity.handle !== INVALID_HANDLE
  // An unverified handle comes back as handle.invalid; keep the one on record
  // so the DNS row still names the domain to fix.
  const handle = verified ? identity.handle : account.handle
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
  if (actor.account?.role !== 'admin') {
    throw new BlueskyLinkError('Only an admin can use this server’s name.', 400)
  }
  const host = getInstanceHost()
  if (host.includes(':')) {
    throw new BlueskyLinkError('This server’s address cannot be a handle.', 400)
  }
  if (!(await database.getBlueskyAccount({ actorId: actor.id }))) {
    throw new BlueskyLinkError('Link a Bluesky account first.', 400)
  }
  const saved = await database.setBlueskyInstanceHandle({
    actorId: actor.id,
    host: enabled ? host : null
  })
  if (!saved) {
    throw new BlueskyLinkError(
      `Another profile already answers for ${host}.`,
      409
    )
  }
}

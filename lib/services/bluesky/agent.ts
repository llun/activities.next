import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { getServedAuthority } from '@/lib/utils/host'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  createBlueskyLock,
  deleteStoredBlueskySession,
  getBlueskyOAuthClient,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from './client'

const MAX_BODY_BYTES = 2 * 1024 * 1024

/** The PDS refused the stored session for good; the user must link again. */
export class BlueskySessionEndedError extends Error {
  constructor(message = 'Bluesky ended this session') {
    super(message)
    this.name = 'BlueskySessionEndedError'
  }
}

/**
 * A hosted account (on this server's PDS) that may not be used now. Its
 * message is what Settings and the cross-post status show: the fix is in
 * "Host my Bluesky account here", not a new link.
 */
export class BlueskyHostedAccountInactiveError extends BlueskySessionEndedError {
  // off: the owner turned it off. unavailable: off for a reason the owner
  // cannot undo there (not approved or confirmed yet, being deleted).
  constructor(status: 'off' | 'unavailable' | 'takendown' | 'gone') {
    super(
      status === 'off'
        ? 'Your Bluesky account on this server is off. Turn it on under “Host my Bluesky account here”.'
        : status === 'unavailable'
          ? 'Your Bluesky account on this server isn’t available right now.'
          : status === 'takendown'
            ? 'Your Bluesky account on this server is suspended.'
            : 'Your Bluesky account on this server is no longer available.'
    )
    this.name = 'BlueskyHostedAccountInactiveError'
  }
}

/** The stored session was replaced (relinked) while a request ran. */
export class BlueskySessionChangedError extends Error {
  constructor() {
    super('The Bluesky session changed; try again.')
    this.name = 'BlueskySessionChangedError'
  }
}

/** A non-2xx XRPC answer, carrying only what the PDS said back. */
export class BlueskyRequestError extends Error {
  constructor(
    nsid: string,
    readonly status: number,
    readonly error?: string,
    xrpcMessage?: string
  ) {
    super(
      `Bluesky ${nsid} failed (${status})${error ? `: ${error}` : ''}${
        xrpcMessage ? ` ${xrpcMessage.slice(0, 200)}` : ''
      }`
    )
    this.name = 'BlueskyRequestError'
  }
}

/** The PDS answered 2xx with a body that is not the expected shape. */
export class BlueskyUnexpectedAnswerError extends Error {
  constructor(nsid: string) {
    super(`Bluesky ${nsid} gave an unexpected answer`)
    this.name = 'BlueskyUnexpectedAnswerError'
  }
}

export type BlueskyQueryParams = Record<
  string,
  string | number | boolean | string[] | undefined
>

/** A blob the PDS stored, as a record's image or video references it. */
export type BlueskyBlobRef = {
  $type: 'blob'
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface BlueskyAgent {
  did: string
  pdsUrl: string
  get<T>(nsid: string, params?: BlueskyQueryParams): Promise<T>
  post<T>(nsid: string, body: unknown): Promise<T>
  /** Uploads raw bytes; the PDS answers with the blob reference to store. */
  uploadBlob(bytes: Uint8Array, mimeType: string): Promise<BlueskyBlobRef>
}

type XrpcRequest = {
  method: 'GET' | 'POST'
  path: string
  body?: string | Uint8Array
  // Defaults to application/json when a body is sent.
  contentType?: string
}
type XrpcResponse = { status: number; text: string }

export const readXrpcError = (text: string) => {
  try {
    const value: unknown = JSON.parse(text)
    const { error, message } = (value ?? {}) as Record<string, unknown>
    return {
      error: typeof error === 'string' ? error : undefined,
      message: typeof message === 'string' ? message : undefined
    }
  } catch {
    return {}
  }
}

// A CIDv1 in base32, the only form a PDS returns for a stored blob.
const CID_V1_BASE32_PATTERN = /^b[a-z2-7]{50,}$/

const parseBlobRef = (nsid: string, answer: unknown): BlueskyBlobRef => {
  const blob = (answer as { blob?: unknown } | null | undefined)?.blob as
    | {
        ref?: { $link?: unknown }
        mimeType?: unknown
        size?: unknown
      }
    | null
    | undefined
  const link = blob?.ref?.$link
  if (
    !blob ||
    typeof link !== 'string' ||
    !CID_V1_BASE32_PATTERN.test(link) ||
    typeof blob.mimeType !== 'string' ||
    typeof blob.size !== 'number'
  ) {
    throw new BlueskyUnexpectedAnswerError(nsid)
  }
  return {
    $type: 'blob',
    ref: { $link: link },
    mimeType: blob.mimeType,
    size: blob.size
  }
}

const isTokenError = (response: XrpcResponse, codes: string[]) =>
  (response.status === 400 || response.status === 401) &&
  codes.includes(readXrpcError(response.text).error ?? '')

export const buildPath = (nsid: string, params?: BlueskyQueryParams) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item))
    }
  }
  const query = search.toString()
  return `/xrpc/${nsid}${query ? `?${query}` : ''}`
}

const createOAuthSend = (database: Database, actor: Actor, did: string) => {
  // The session belongs to the client_id of the actor's canonical domain.
  const client = getBlueskyOAuthClient(
    database,
    getServedAuthority(actor.domain) ?? actor.domain
  )
  if (!client) throw new Error('Bluesky sign-in is not set up on this server')
  return async ({
    method,
    path,
    body,
    contentType
  }: XrpcRequest): Promise<XrpcResponse> => {
    let response: Response
    try {
      // fetchHandler handles DPoP, nonce retries and refresh under the lock.
      const session = await (await client).restore(did)
      response = await session.fetchHandler(path, {
        method,
        ...(body !== undefined
          ? {
              // A fresh view, so the DOM's BodyInit accepts the bytes.
              body: body instanceof Uint8Array ? new Uint8Array(body) : body,
              headers: { 'Content-Type': contentType ?? 'application/json' }
            }
          : {})
      })
    } catch (error) {
      // Loaded here, not at the top: `@atproto/*` is ESM-only and this module
      // is reached from CommonJS scripts through the job registry. A failed
      // load must not replace the request's own error.
      const tokenErrors = await import('@atproto/oauth-client-node').catch(
        () => null
      )
      if (
        tokenErrors &&
        (error instanceof tokenErrors.TokenRefreshError ||
          error instanceof tokenErrors.TokenRevokedError ||
          error instanceof tokenErrors.TokenInvalidError)
      ) {
        // Relinked with an app password while this request ran: the library
        // sees no OAuth session, but the new one is fine, so keep it.
        const stored = await readStoredBlueskySession(database, did)
        if (stored && stored.type !== 'oauth') {
          throw new BlueskySessionChangedError()
        }
        throw new BlueskySessionEndedError()
      }
      throw error
    }
    // The library drops the stored session when a refresh is refused or a
    // fresh token is still rejected; a transient refresh failure keeps it.
    if (
      response.status === 401 &&
      !(await database.getBlueskySession({ did }))
    ) {
      throw new BlueskySessionEndedError()
    }
    return { status: response.status, text: await response.text() }
  }
}

const createAppPasswordSend = (
  database: Database,
  did: string,
  pdsUrl: string,
  initial: { accessJwt: string; refreshJwt: string }
) => {
  let tokens = initial
  const xrpc = async (
    { method, path, body, contentType }: XrpcRequest,
    bearer: string
  ): Promise<XrpcResponse> => {
    const result = await safeRemoteFetch({
      url: new URL(path, pdsUrl).href,
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body !== undefined
          ? { 'Content-Type': contentType ?? 'application/json' }
          : {})
      },
      ...(typeof body === 'string'
        ? { body }
        : body !== undefined
          ? { bodyBytes: body }
          : {}),
      maxRedirects: 0,
      maxBodyBytes: MAX_BODY_BYTES
    })
    return { status: result.statusCode, text: result.body }
  }

  // Refresh tokens are single use: refresh under a cross-instance lock, and
  // only when no other instance has already replaced the stale token.
  const refresh = (staleAccessJwt: string) =>
    createBlueskyLock(database)(
      `bluesky-app-password-refresh:${did}`,
      async () => {
        const stored = await readStoredBlueskySession(database, did)
        if (!stored) throw new BlueskySessionEndedError()
        // Relinked (say, with OAuth) while this request ran: the new session
        // is fine, so fail this request without ending (deleting) it.
        if (stored.type !== 'app_password') {
          throw new BlueskySessionChangedError()
        }
        if (stored.accessJwt !== staleAccessJwt) return stored
        const nsid = 'com.atproto.server.refreshSession'
        const response = await xrpc(
          { method: 'POST', path: `/xrpc/${nsid}` },
          stored.refreshJwt
        )
        if (isTokenError(response, ['ExpiredToken', 'InvalidToken'])) {
          throw new BlueskySessionEndedError()
        }
        if (response.status !== 200) {
          const { error, message } = readXrpcError(response.text)
          throw new BlueskyRequestError(nsid, response.status, error, message)
        }
        const answer = JSON.parse(response.text) as Record<string, unknown>
        if (
          answer.did !== did ||
          typeof answer.accessJwt !== 'string' ||
          typeof answer.refreshJwt !== 'string'
        ) {
          throw new Error('Bluesky refreshSession gave an unexpected answer')
        }
        const next = {
          type: 'app_password' as const,
          accessJwt: answer.accessJwt,
          refreshJwt: answer.refreshJwt
        }
        await writeStoredBlueskySession(database, did, next)
        return next
      }
    )

  return async (request: XrpcRequest): Promise<XrpcResponse> => {
    const first = await xrpc(request, tokens.accessJwt)
    if (!isTokenError(first, ['ExpiredToken'])) return first
    tokens = await refresh(tokens.accessJwt)
    return xrpc(request, tokens.accessJwt)
  }
}

// The hosted account's client runs the embedded PDS, whose `@atproto/*`
// imports CommonJS callers (scripts, the queue worker) cannot load, so it is
// loaded on first use. Under tsx/cjs this `@/` import cannot resolve: hosted
// accounts are served by the app process (its in-process queue runner, or a
// QStash or Cloud Tasks queue), not by the CommonJS worker. Only that known
// resolution failure is reworded; any other error is the module's own.
const COMMONJS_LOAD_ERRORS = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_REQUIRE_ESM'
])

export const loadHostedAgent = async (
  load = () => import('@/lib/services/pds/hostedAgent')
) => {
  try {
    return await load()
  } catch (error) {
    if (
      !COMMONJS_LOAD_ERRORS.has((error as { code?: unknown })?.code as string)
    ) {
      throw error
    }
    throw new Error(
      'Hosted Bluesky accounts cannot be served from this process; run the queue in the app process',
      { cause: error }
    )
  }
}

/** Null when the actor has no linked Bluesky account or no stored session. */
export const getBlueskyAgent = async (
  database: Database,
  actor: Actor
): Promise<BlueskyAgent | null> => {
  const account = await database.getBlueskyAccount({ actorId: actor.id })
  if (!account) return null
  if (account.authType === 'hosted') {
    const { createHostedBlueskyAgent } = await loadHostedAgent()
    return createHostedBlueskyAgent(database, actor, account)
  }
  const { did, pdsUrl } = account
  const stored = await readStoredBlueskySession(database, did)
  if (!stored || (stored.type !== 'oauth' && stored.type !== 'app_password')) {
    return null
  }
  // The stored session's own tag decides how it is used.
  const send =
    stored.type === 'oauth'
      ? createOAuthSend(database, actor, did)
      : createAppPasswordSend(database, did, pdsUrl, stored)

  const run = async <T>(nsid: string, request: XrpcRequest): Promise<T> => {
    try {
      const response = await send(request)
      if (response.status < 200 || response.status >= 300) {
        const { error, message } = readXrpcError(response.text)
        throw new BlueskyRequestError(nsid, response.status, error, message)
      }
      return (response.text ? JSON.parse(response.text) : undefined) as T
    } catch (error) {
      // Settings shows "Bluesky ended this session" once the session is gone.
      if (error instanceof BlueskySessionEndedError) {
        await deleteStoredBlueskySession(database, did, stored.type)
      }
      throw error
    }
  }

  return {
    did,
    pdsUrl,
    get: (nsid, params) =>
      run(nsid, { method: 'GET', path: buildPath(nsid, params) }),
    post: (nsid, body) =>
      run(nsid, {
        method: 'POST',
        path: buildPath(nsid),
        body: JSON.stringify(body ?? {})
      }),
    uploadBlob: async (bytes, mimeType) => {
      const nsid = 'com.atproto.repo.uploadBlob'
      const answer = await run<unknown>(nsid, {
        method: 'POST',
        path: buildPath(nsid),
        body: bytes,
        contentType: mimeType
      })
      return parseBlobRef(nsid, answer)
    }
  }
}

import { isValidNsid } from '@atproto/syntax'
import type { NextRequest } from 'next/server'

import type { BlueskyPdsDomainConfig } from '@/lib/config/blueskyPds'

import { handlePublicReadXrpc } from './publicRead'

/**
 * What a dispatched method may do, and therefore what gates it:
 *
 * - `public-read`: anonymous reads a relay, AppView or client makes today.
 * - `session`: sign-in and session management (`com.atproto.server.*`).
 * - `authed-read`: reads that need a session (`identity.resolveHandle`,
 *   `app.bsky.actor.getPreferences`).
 * - `proxy`: `app.bsky.*` and `chat.bsky.*` calls forwarded to the AppView.
 * - `write`: repo and blob writes (`com.atproto.repo.*`).
 */
export type PdsXrpcCategory =
  'public-read' | 'session' | 'authed-read' | 'proxy' | 'write'

export type PdsXrpcHttpMethod = 'GET' | 'POST'

export type PdsXrpcHandlerContext = {
  req: NextRequest
  pdsDomain: BlueskyPdsDomainConfig
  nsid: string
  isHead: boolean
}

export type PdsXrpcHandler = (
  context: PdsXrpcHandlerContext
) => Promise<Response>

export type PdsXrpcDispatchEntry = {
  method: PdsXrpcHttpMethod
  nsid: string
  category: PdsXrpcCategory
  /** `null` until the category's handler lands; the route answers 501. */
  handler: PdsXrpcHandler | null
}

const publicRead = (nsid: string): PdsXrpcDispatchEntry => ({
  method: 'GET',
  nsid,
  category: 'public-read',
  handler: handlePublicReadXrpc
})

const pending = (
  method: PdsXrpcHttpMethod,
  nsid: string,
  category: Exclude<PdsXrpcCategory, 'public-read'>
): PdsXrpcDispatchEntry => ({ method, nsid, category, handler: null })

/**
 * Every XRPC method the PDS answers, by HTTP method and NSID. Public reads are
 * served today; the rest are listed so later work fills their handlers here
 * and the route never changes again.
 */
export const PDS_XRPC_DISPATCH: readonly PdsXrpcDispatchEntry[] = [
  publicRead('com.atproto.server.describeServer'),
  publicRead('com.atproto.repo.describeRepo'),
  publicRead('com.atproto.repo.getRecord'),
  publicRead('com.atproto.repo.listRecords'),
  publicRead('com.atproto.sync.getRepo'),
  publicRead('com.atproto.sync.getRecord'),
  publicRead('com.atproto.sync.getBlocks'),
  publicRead('com.atproto.sync.getLatestCommit'),
  publicRead('com.atproto.sync.getRepoStatus'),
  publicRead('com.atproto.sync.listRepos'),
  publicRead('com.atproto.sync.listBlobs'),
  publicRead('com.atproto.sync.getBlob'),

  pending('POST', 'com.atproto.server.createSession', 'session'),
  pending('POST', 'com.atproto.server.refreshSession', 'session'),
  pending('GET', 'com.atproto.server.getSession', 'session'),
  pending('POST', 'com.atproto.server.deleteSession', 'session'),
  pending('GET', 'com.atproto.server.getServiceAuth', 'session'),
  pending('GET', 'com.atproto.server.checkAccountStatus', 'session'),
  pending('GET', 'com.atproto.server.listAppPasswords', 'session'),
  pending('POST', 'com.atproto.server.revokeAppPassword', 'session'),

  pending('GET', 'com.atproto.identity.resolveHandle', 'authed-read'),
  pending('GET', 'app.bsky.actor.getPreferences', 'authed-read'),

  pending('POST', 'com.atproto.repo.createRecord', 'write'),
  pending('POST', 'com.atproto.repo.putRecord', 'write'),
  pending('POST', 'com.atproto.repo.deleteRecord', 'write'),
  pending('POST', 'com.atproto.repo.applyWrites', 'write'),
  pending('POST', 'com.atproto.repo.uploadBlob', 'write'),
  pending('POST', 'app.bsky.actor.putPreferences', 'write')
]

/**
 * `app.bsky.*` and `chat.bsky.*` proxy to the AppView; one entry covers the
 * whole namespace, filled in when the proxy handler lands.
 */
export const PDS_XRPC_PROXY_NSID_PREFIXES = ['app.bsky.', 'chat.bsky.'] as const

const dispatchIndex = new Map(
  PDS_XRPC_DISPATCH.map((entry) => [`${entry.method} ${entry.nsid}`, entry])
)

const dispatchNsids = new Set(PDS_XRPC_DISPATCH.map((entry) => entry.nsid))

/**
 * The entry for `method` + `nsid`, an exact match first and then the generic
 * proxy namespace, or `null` for a method the PDS does not answer. A locally
 * owned NSID never falls through to the proxy prefix on the other verb.
 */
export const getPdsXrpcDispatchEntry = (
  method: PdsXrpcHttpMethod,
  nsid: string
): PdsXrpcDispatchEntry | null => {
  if (!isValidNsid(nsid)) return null
  const exact = dispatchIndex.get(`${method} ${nsid}`)
  if (exact) return exact
  if (dispatchNsids.has(nsid)) return null
  if (PDS_XRPC_PROXY_NSID_PREFIXES.some((prefix) => nsid.startsWith(prefix))) {
    return { method, nsid, category: 'proxy', handler: null }
  }
  return null
}

/**
 * Whether `entry` may run on `pdsDomain`: public reads always, every other
 * category only when the domain opts in to Bluesky-app sign-in.
 */
export const isPdsXrpcCategoryEnabled = (
  entry: PdsXrpcDispatchEntry,
  pdsDomain: Pick<BlueskyPdsDomainConfig, 'clientSignIn'>
): boolean => entry.category === 'public-read' || pdsDomain.clientSignIn

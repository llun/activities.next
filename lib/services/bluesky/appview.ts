// Reads public Bluesky data from Bluesky's own AppView. Bluesky posts and
// profiles are stored as rows every user of this server sees, so their content
// must not come from a user's linked PDS: a self-hosted PDS can answer
// anything, for any DID. A user's PDS only decides which posts are in that
// user's Home (lib/services/bluesky/sync.ts).
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  type BlueskyQueryParams,
  BlueskyRequestError,
  buildPath,
  readXrpcError
} from './agent'

// A constant, never configurable or taken from a user's account: this host is
// what the stored content is trusted for.
export const BLUESKY_APPVIEW_URL = 'https://public.api.bsky.app'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 10_000
// getPosts and getProfiles take at most 25 items per call.
const BATCH_SIZE = 25

export const appViewGet = async <T>(
  nsid: string,
  params?: BlueskyQueryParams
): Promise<T> => {
  const result = await safeRemoteFetch({
    url: new URL(buildPath(nsid, params), BLUESKY_APPVIEW_URL).href,
    method: 'GET',
    headers: { Accept: 'application/json' },
    maxRedirects: 0,
    maxBodyBytes: MAX_BODY_BYTES,
    timeoutInMilliseconds: TIMEOUT_MS
  })
  if (result.statusCode < 200 || result.statusCode >= 300) {
    const { error, message } = readXrpcError(result.body)
    throw new BlueskyRequestError(nsid, result.statusCode, error, message)
  }
  return JSON.parse(result.body) as T
}

const inBatches = async (
  items: string[],
  read: (batch: string[]) => Promise<unknown[]>
): Promise<unknown[]> => {
  const unique = [...new Set(items)]
  const results: unknown[] = []
  for (let start = 0; start < unique.length; start += BATCH_SIZE) {
    results.push(...(await read(unique.slice(start, start + BATCH_SIZE))))
  }
  return results
}

const listOf = (value: unknown) => (Array.isArray(value) ? value : [])

/**
 * The post views (app.bsky.feed.defs#postView) of `uris`. A post the AppView
 * does not return (deleted, taken down, blocked) is left out.
 */
export const getPublicPosts = (uris: string[]): Promise<unknown[]> =>
  inBatches(uris, async (batch) =>
    listOf(
      (
        await appViewGet<{ posts?: unknown }>('app.bsky.feed.getPosts', {
          uris: batch
        })
      )?.posts
    )
  )

/** The detailed profile views of `actors` (DIDs or handles); unknown ones are left out. */
export const getPublicProfiles = (actors: string[]): Promise<unknown[]> =>
  inBatches(actors, async (batch) =>
    listOf(
      (
        await appViewGet<{ profiles?: unknown }>('app.bsky.actor.getProfiles', {
          actors: batch
        })
      )?.profiles
    )
  )

export const getPublicProfile = async (actor: string): Promise<unknown> =>
  (await getPublicProfiles([actor]))[0] ?? null

export const getPublicAuthorFeed = (
  did: string,
  { limit, cursor }: { limit: number; cursor?: string }
) =>
  appViewGet<{ feed?: unknown; cursor?: unknown }>(
    'app.bsky.feed.getAuthorFeed',
    { actor: did, limit, cursor }
  )

const DEFAULT_THREAD_DEPTH = 6
const DEFAULT_THREAD_PARENT_HEIGHT = 20

export const getPublicPostThread = (
  uri: string,
  {
    depth = DEFAULT_THREAD_DEPTH,
    parentHeight = DEFAULT_THREAD_PARENT_HEIGHT
  }: { depth?: number; parentHeight?: number } = {}
) =>
  appViewGet<{ thread?: unknown }>('app.bsky.feed.getPostThread', {
    uri,
    depth: Math.min(Math.max(Math.floor(depth), 0), DEFAULT_THREAD_DEPTH),
    parentHeight: Math.min(
      Math.max(Math.floor(parentHeight), 0),
      DEFAULT_THREAD_PARENT_HEIGHT
    )
  })

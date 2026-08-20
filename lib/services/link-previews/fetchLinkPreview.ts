import { Database } from '@/lib/database/types'
import { normalizePreviewUrl } from '@/lib/services/link-previews/extractUrl'
import { parseOpenGraphMetadata } from '@/lib/services/link-previews/parseOpenGraph'
import { LinkPreviewRecord } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import packageJson from '@/package.json'

// A card is re-read a week after it was last fetched. Long enough that a link
// doing the rounds is fetched once rather than once per post, short enough that
// a retitled article eventually catches up.
export const LINK_PREVIEW_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

// How long a failure suppresses re-fetching. Without it, a host that is down
// (or blocks us) is re-contacted for every single post that mentions it —
// the same trap the remote-actor refresh path avoids by stamping its failures.
export const LINK_PREVIEW_FAILURE_TTL_MS = 60 * 60 * 1000

// Deliberately tighter than the 2 MiB `safeRemoteFetch` default: the metadata
// lives in <head>, and a page bigger than this is not one we want to parse
// inline in a request on a NoQueue deployment.
export const LINK_PREVIEW_MAX_BODY_BYTES = 1024 * 1024

// Bounds the worst case a NoQueue deployment adds to a post request.
export const LINK_PREVIEW_TIMEOUT_MS = 7_500

const ACCEPTED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']

// The fetcher identifies itself and points at the project, so an operator
// seeing these requests in their logs can tell what they are and who to
// contact — the etiquette Mastodon's own crawler UA follows.
const LINK_PREVIEW_USER_AGENT = `activities.next/${packageJson.version} (+https://github.com/llun/activities.next; link preview)`

const REQUEST_HEADERS = {
  'User-Agent': LINK_PREVIEW_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  'Accept-Language': 'en;q=0.9,*;q=0.5'
}

class LinkPreviewFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkPreviewFetchError'
  }
}

const getErrorCode = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  if (error instanceof Error) return error.message
  return 'ERR_LINK_PREVIEW_FAILED'
}

// `text/html; charset=utf-8` → `text/html`, plus the charset for the guard
// below.
const parseContentType = (raw: string | string[] | undefined) => {
  if (Array.isArray(raw)) raw = raw[0]
  if (!raw) return { mimeType: null, charset: null }
  const [mimeType, ...parameters] = raw.split(';')
  const charset = parameters
    .map((parameter) => parameter.trim().toLowerCase())
    .find((parameter) => parameter.startsWith('charset='))
    ?.slice('charset='.length)
    .replace(/^["']|["']$/g, '')
  return {
    mimeType: mimeType.trim().toLowerCase(),
    charset: charset ?? null
  }
}

const isFresh = (record: LinkPreviewRecord, currentTime: number): boolean => {
  const age = currentTime - record.updatedAt
  if (record.fetchStatus === 'completed') {
    return age < LINK_PREVIEW_REFRESH_TTL_MS
  }
  if (record.fetchStatus === 'failed') {
    return age < LINK_PREVIEW_FAILURE_TTL_MS
  }
  return false
}

export type FetchLinkPreviewParams = {
  database: Database
  url: string
}

/**
 * Fetch (or serve from cache) the preview card for one URL.
 *
 * Returns the card only when there is one to show: a failure is recorded as a
 * negative-cache row and reported as null, so a caller never links a status to
 * a card that would render as an empty box.
 */
export const fetchLinkPreview = async ({
  database,
  url
}: FetchLinkPreviewParams): Promise<LinkPreviewRecord | null> => {
  const normalizedUrl = normalizePreviewUrl(url)
  if (!normalizedUrl) return null

  const urlHash = getHashFromString(normalizedUrl)
  const existing = await database.getLinkPreview({ urlHash })
  if (existing && isFresh(existing, Date.now())) {
    return existing.fetchStatus === 'completed' ? existing : null
  }

  try {
    const response = await safeRemoteFetch({
      url: normalizedUrl,
      headers: REQUEST_HEADERS,
      maxBodyBytes: LINK_PREVIEW_MAX_BODY_BYTES,
      timeoutInMilliseconds: LINK_PREVIEW_TIMEOUT_MS
    })

    if (response.statusCode !== 200) {
      throw new LinkPreviewFetchError(`ERR_HTTP_${response.statusCode}`)
    }

    const { mimeType, charset } = parseContentType(
      getHeaderValue(response.headers, 'content-type')
    )
    if (!mimeType || !ACCEPTED_CONTENT_TYPES.includes(mimeType)) {
      throw new LinkPreviewFetchError('ERR_UNSUPPORTED_CONTENT_TYPE')
    }
    // `safeRemoteFetch` decodes the body as UTF-8, so a page that declares
    // another encoding would be parsed into mojibake and stored that way.
    // Storing a broken title is worse than storing no card; decoding these
    // properly needs a bytes-level fetch and is deliberately left out of v1.
    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      throw new LinkPreviewFetchError('ERR_UNSUPPORTED_CHARSET')
    }

    // Relative URLs in the metadata resolve against where the redirect chain
    // actually ended, not where we started.
    const metadata = parseOpenGraphMetadata(response.body, response.url)
    if (!metadata) {
      throw new LinkPreviewFetchError('ERR_NO_METADATA')
    }

    return await database.upsertLinkPreview({
      urlHash,
      // The card keeps the URL as it appeared in the post, so the anchor a
      // reader clicks is the link the author actually shared.
      url: normalizedUrl,
      ...metadata,
      fetchStatus: 'completed',
      error: null
    })
  } catch (error) {
    const code = getErrorCode(error)
    logger.warn({
      message: 'linkPreview: failed to fetch preview card',
      url: normalizedUrl,
      error: code,
      err: toLoggableError(error)
    })
    // Recorded rather than merely logged: this row is the negative cache that
    // keeps the next post mentioning this URL from re-contacting a host that
    // just failed.
    await database.upsertLinkPreview({
      urlHash,
      url: normalizedUrl,
      fetchStatus: 'failed',
      error: code
    })
    return null
  }
}

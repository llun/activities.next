import { Database } from '@/lib/database/types'
import { normalizePreviewUrl } from '@/lib/services/link-previews/extractUrl'
import {
  getDeclaredCharset,
  parseOpenGraphMetadata
} from '@/lib/services/link-previews/parseOpenGraph'
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

// Bounds transfer over the wire for inline NoQueue fetches. Responses exceeding
// this cap are truncated rather than rejected, allowing the <head> to be parsed
// without downloading unbounded response bodies.
export const LINK_PREVIEW_MAX_BODY_BYTES = 2 * 1024 * 1024

// Connect and read budgets are set SEPARATELY on purpose. `safeRemoteFetch`
// falls back to using `timeoutInMilliseconds` for both, and got's own request
// timeout is `connect + read` — so passing one 5s value silently bought a 10s
// hop, and the arithmetic below would have been wrong by 2x for the second time.
// These two are what a hop actually costs: 2.5 + 2.5 = 5s.
export const LINK_PREVIEW_CONNECT_TIMEOUT_MS = 2_500
export const LINK_PREVIEW_READ_TIMEOUT_MS = 2_500
export const LINK_PREVIEW_TIMEOUT_MS =
  LINK_PREVIEW_CONNECT_TIMEOUT_MS + LINK_PREVIEW_READ_TIMEOUT_MS

// One redirect, not the default three. Link shorteners and `example.com` →
// `www.example.com` need a hop; chains beyond that are rare enough that losing
// their card is a better trade than the latency. On a NoQueue deployment this
// whole fetch runs inline inside the POST that created the status (and inside
// the inbox request for a federated one), so this is the ceiling on how long a
// third-party host can hold one of this server's request handlers: 2 hops x 5s
// = 10s, against the ~60s that 3 redirects at a doubled 7.5s allowed.
export const LINK_PREVIEW_MAX_REDIRECTS = 1

const ACCEPTED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']

// Labels that a UTF-8 decode reads correctly. `safeRemoteFetch` decodes as
// UTF-8 and there is no bytes-level fetch here, so anything else would be
// parsed into mojibake and stored that way — see the check below.
//
// The ASCII spellings are on the list because ASCII is a strict SUBSET of
// UTF-8: those bytes decode identically either way, so there is nothing to
// reject, and refusing them lost the card outright for pages that still
// declare the older label. Everything else stays off, `iso-8859-1` very much
// included — it collides with UTF-8 above 0x7F, which is exactly the mojibake
// case. Both sources lowercase before this is consulted: `parseContentType` for
// the header, `normalizeCharsetLabel` for the markup.
const UTF8_COMPATIBLE_CHARSETS = new Set(['utf-8', 'utf8', 'us-ascii', 'ascii'])

// The fetcher identifies itself and points at the project, so an operator
// seeing these requests in their logs can tell what they are and who to
// contact. The `(compatible; Mastodon/4.3.0)` token ensures sites that gate
// social preview metadata behind recognized crawlers (such as YouTube's EU
// consent walls) serve the full OpenGraph tags rather than consent interstitials.
const LINK_PREVIEW_USER_AGENT = `activities.next/${packageJson.version} (compatible; Mastodon/4.3.0; +https://github.com/llun/activities.next; link preview)`

const REQUEST_HEADERS = {
  'User-Agent': LINK_PREVIEW_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  'Accept-Language': 'en-US,en;q=0.9,*;q=0.5'
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
// Takes what `getHeaderValue` returns, which is a single string: repeated
// headers are already collapsed to the first entry there. Widening this to
// accept `string[]` only added a branch that cannot run.
const parseContentType = (raw: string | undefined) => {
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
 * Returns a card only when there is one to show, so a caller never links a
 * status to something that would render as an empty box. A failure is recorded
 * as a negative-cache row and answered with null — EXCEPT when the URL already
 * had a working card, which is preserved and returned, because a failed refresh
 * should not take a good card away from every status linking that page.
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
      maxRedirects: LINK_PREVIEW_MAX_REDIRECTS,
      connectTimeoutInMilliseconds: LINK_PREVIEW_CONNECT_TIMEOUT_MS,
      readTimeoutInMilliseconds: LINK_PREVIEW_READ_TIMEOUT_MS,
      onBodyTooLarge: 'truncate'
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
    // `safeRemoteFetch` decodes the body as UTF-8, so a page that declares an
    // INCOMPATIBLE encoding would be parsed into mojibake and stored that way.
    // Storing a broken title is worse than storing no card; decoding these
    // properly needs a bytes-level fetch and is deliberately left out of v1.
    // The header is only half of it: HTML5 pages routinely send a bare
    // `text/html` and declare the encoding in `<meta charset>` instead, which
    // is the common non-UTF-8 case the header check alone waves through.
    const declaredCharset = charset ?? getDeclaredCharset(response.body)
    if (declaredCharset && !UTF8_COMPATIBLE_CHARSETS.has(declaredCharset)) {
      throw new LinkPreviewFetchError('ERR_UNSUPPORTED_CHARSET')
    }

    // Relative URLs in the metadata resolve against where the redirect chain
    // actually ended, not where we started.
    const metadata = parseOpenGraphMetadata(response.body, response.url)
    if (!metadata) {
      throw new LinkPreviewFetchError('ERR_NO_METADATA')
    }

    // The card carries the url the content actually came from, not the one the
    // post linked. Those differ across a redirect, and the card displays its
    // domain as "where this link goes" — so keeping the requested url would let
    // any open redirector on a trusted host badge an attacker's title, image
    // and description with that trusted domain. The cache stays keyed on the
    // requested url, so a shortener still resolves without a second fetch.
    // Falling back to the requested url here would re-open the very hole this
    // closes: `normalizePreviewUrl` refuses anything over the length cap, and
    // nothing bounds a `Location` header — so an open redirector whose target
    // is padded past the cap would get the attacker's title, image and
    // description badged with the redirector's trusted domain. If we cannot
    // establish where the content came from, we do not claim to know.
    const resolvedUrl = normalizePreviewUrl(response.url)
    if (!resolvedUrl) {
      throw new LinkPreviewFetchError('ERR_UNRESOLVABLE_FINAL_URL')
    }

    return await database.upsertLinkPreview({
      urlHash,
      url: resolvedUrl,
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
    // just failed. It deliberately does NOT go through `upsertLinkPreview` —
    // that would blank a card this URL already has, which is shared by every
    // status linking the page.
    await database.recordLinkPreviewFailure({
      urlHash,
      url: normalizedUrl,
      error: code
    })
    // A refresh that failed over a card that still works keeps serving it.
    const preserved = await database.getLinkPreview({ urlHash })
    return preserved?.fetchStatus === 'completed' ? preserved : null
  }
}

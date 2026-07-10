import { z } from 'zod'

import {
  decodePathParam,
  resolveStatusFromPath
} from '@/app/(timeline)/[actor]/[status]/resolveStatusFromPath'
import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServedDomains } from '@/lib/services/auth/servedDomains'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import { getMention, getMentionFromActorID } from '@/lib/types/domain/actor'
import { getOriginalStatus } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const DEFAULT_WIDTH = 400
const CACHE_AGE_SECONDS = 86400

const OEmbedQuery = z.object({
  url: z.string().min(1),
  maxwidth: z.coerce.number().int().positive().optional(),
  maxheight: z.coerce.number().int().positive().optional()
})

interface StatusPageTarget {
  actorParam: string
  statusParam: string
  pageUrl: URL
}

// Accepts the public status page URL forms this server serves:
// /@user/<status> and /@user@domain/<status> on the configured host or a
// trusted host. Segments may be percent-encoded (the discovery link emits
// them encoded); <status> may be a short id, a full remote status URL, or a
// 64-hex url hash — exactly the inputs resolveStatusFromPath handles.
const parseStatusPageUrl = (
  rawUrl: string,
  servedDomains: ReadonlySet<string>
): StatusPageTarget | null => {
  let pageUrl: URL
  try {
    pageUrl = new URL(rawUrl)
  } catch {
    return null
  }

  if (pageUrl.protocol !== 'https:' && pageUrl.protocol !== 'http:') {
    return null
  }
  if (!servedDomains.has(pageUrl.hostname)) return null

  const segments = pageUrl.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) return null

  const actorSegment = decodePathParam(segments[0])
  if (!actorSegment.startsWith('@')) return null

  // Single-@ form (/@user/<status>): the proxy serves it on the request host,
  // so qualify the username with the page URL's host.
  const actorParam =
    actorSegment.split('@').length === 3
      ? actorSegment
      : `${actorSegment}@${pageUrl.host}`

  return { actorParam, statusParam: segments[1], pageUrl }
}

// https://docs.joinmastodon.org/methods/oembed/
// Public, unauthenticated oEmbed provider for public status pages. Unknown
// URLs, URLs on foreign hosts, and non-distributable (not public/unlisted)
// statuses all return 404, and lookups never trigger federation fetches.
export const GET = traceApiRoute('getOEmbed', async (req) => {
  const database = getDatabase()
  if (!database) return apiCorsError(req, CORS_HEADERS, 500)

  const query = OEmbedQuery.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  )
  if (!query.success) return apiCorsError(req, CORS_HEADERS, 400)

  const config = getConfig()
  const servedDomains = new Set(
    getServedDomains(config).map((served) => served.domain)
  )
  const target = parseStatusPageUrl(query.data.url, servedDomains)
  if (!target) return apiCorsError(req, CORS_HEADERS, 404)

  const resolved = await resolveStatusFromPath({
    database,
    actorParam: target.actorParam,
    statusParam: target.statusParam
  })
  const status = resolved?.status
  if (!status || !isStatusPubliclyReadable(status)) {
    return apiCorsError(req, CORS_HEADERS, 404)
  }

  // For a boost page, embed the boosted status — matching what the page shows.
  const displayStatus = getOriginalStatus(status)
  const author = displayStatus.actor
  const authorHandle = author
    ? getMention(author, true)
    : getMentionFromActorID(displayStatus.actorId, true)
  const authorName = author?.name || authorHandle
  const authorUrl = author
    ? `https://${author.domain}/${getMention(author)}`
    : displayStatus.actorId
  const excerpt = htmlToPlainText(displayStatus.text)
  const width = query.data.maxwidth ?? DEFAULT_WIDTH
  const height = query.data.maxheight ?? null

  // There is no status embed widget yet (app/embed only hosts the fitness
  // heatmap), so emit the static blockquote-with-anchor form instead of
  // Mastodon's iframe.
  const html = `<blockquote class="activities-next-embed"><p>${escapeHtml(excerpt)}</p>&mdash; ${escapeHtml(authorName)} (<a href="${escapeHtml(target.pageUrl.href)}">${escapeHtml(authorHandle)}</a>)</blockquote>`

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      type: 'rich',
      version: '1.0',
      title: `New status by ${authorName}`,
      author_name: authorName,
      author_url: authorUrl,
      provider_name: config.host,
      provider_url: getBaseURL(),
      cache_age: CACHE_AGE_SECONDS,
      html,
      width,
      height
    }
  })
})

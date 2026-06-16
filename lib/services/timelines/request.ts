import { NextRequest } from 'next/server'
import { z } from 'zod'

import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_500, apiResponse } from '@/lib/utils/response'
import { safeIdToUrl } from '@/lib/utils/urlToId'

import { normalizeTimelineLimit } from './getFilteredTimelinePage'

// Shared query-param shape for every timeline endpoint. `limit` stays a lenient
// optional string because Mastodon clamps out-of-range/non-numeric limits to the
// allowed range instead of rejecting them (see `normalizeTimelineLimit`); the
// cursors are optional strings here and are decoded/validated below so a
// malformed cursor becomes a deliberate 400 rather than a 500 or wrong results.
const TimelineQuerySchema = z.object({
  limit: z.string().optional(),
  max_id: z.string().optional(),
  min_id: z.string().optional(),
  since_id: z.string().optional(),
  // Mastodon's public-timeline scope filters. Only the public timeline reads
  // them; other endpoints ignore them.
  local: z.string().optional(),
  remote: z.string().optional()
})

export interface ParsedTimelineQuery {
  // Already normalized/clamped to the allowed range.
  limit: number
  // Decoded status URLs, or null when the corresponding cursor was absent.
  maxStatusId: string | null
  minStatusId: string | null
  sinceStatusId: string | null
  // Public-timeline scope (Mastodon `local`/`remote`). Coerced from the truthy
  // string forms Mastodon accepts (`true`/`1`).
  local: boolean
  remote: boolean
}

const isTruthyParam = (value: string | undefined): boolean =>
  value === 'true' || value === '1'

export type ParseTimelineQueryResult =
  | { ok: true; query: ParsedTimelineQuery }
  | { ok: false }

// undefined → cursor not provided; null → provided but undecodable (→ 400).
const decodeCursor = (raw: string | undefined): string | null | undefined =>
  raw === undefined ? undefined : safeIdToUrl(raw)

/**
 * Parse and validate the shared timeline query params. Returns `ok: false` only
 * when a provided `max_id`/`min_id`/`since_id` cursor cannot be decoded — the
 * caller turns that into a 400. `limit` never fails: it is coerced and clamped
 * via `normalizeTimelineLimit`, matching Mastodon's clamping behavior.
 */
export const parseTimelineQuery = (
  searchParams: URLSearchParams
): ParseTimelineQueryResult => {
  // Treat an empty-string param (e.g. `?max_id=`) as absent rather than a value,
  // so a blank cursor means "no cursor" (2xx) instead of failing validation.
  const parsed = TimelineQuerySchema.safeParse({
    limit: searchParams.get('limit') || undefined,
    max_id: searchParams.get('max_id') || undefined,
    min_id: searchParams.get('min_id') || undefined,
    since_id: searchParams.get('since_id') || undefined,
    local: searchParams.get('local') || undefined,
    remote: searchParams.get('remote') || undefined
  })
  if (!parsed.success) return { ok: false }

  const { limit, max_id, min_id, since_id } = parsed.data
  // Floor a decimal limit (e.g. `1.5` → `1`) like Mastodon's integer coercion;
  // `normalizeTimelineLimit` then clamps it to the allowed range. (It already
  // rejects non-integers, so this only changes a float into its floored int
  // rather than the default.)
  const numericLimit = limit !== undefined ? Number(limit) : null
  const pageLimit = normalizeTimelineLimit(
    numericLimit !== null && Number.isFinite(numericLimit)
      ? Math.floor(numericLimit)
      : null
  )

  const maxStatusId = decodeCursor(max_id)
  const minStatusId = decodeCursor(min_id)
  const sinceStatusId = decodeCursor(since_id)
  if (maxStatusId === null || minStatusId === null || sinceStatusId === null) {
    return { ok: false }
  }

  return {
    ok: true,
    query: {
      limit: pageLimit,
      maxStatusId: maxStatusId ?? null,
      minStatusId: minStatusId ?? null,
      sinceStatusId: sinceStatusId ?? null,
      local: isTruthyParam(parsed.data.local),
      remote: isTruthyParam(parsed.data.remote)
    }
  }
}

/**
 * Wrap a timeline route handler so any unexpected throw (e.g. a transient DB
 * fault) is logged and returned as a CORS-aware 500 instead of bubbling up as an
 * unhandled rejection — `traceApiRoute` re-throws, so without this a throw in the
 * handler body becomes a generic, header-less 500. This is only a backstop for
 * genuine server faults; valid requests must still return 2xx and bad input 4xx.
 */
export const timelineErrorBoundary =
  <Context>(
    allowedMethods: HttpMethod[],
    handler: (req: NextRequest, context: Context) => Promise<Response>
  ) =>
  async (req: NextRequest, context: Context): Promise<Response> => {
    try {
      return await handler(req, context)
    } catch (error) {
      logger.error({
        message: 'Unhandled error in timeline handler',
        // Log the stack (falling back to the message) so production 500s carry
        // the throw site, not just the message.
        error:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
      })
      return apiResponse({
        req,
        allowedMethods,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }
  }

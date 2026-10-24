import { z } from 'zod'

import { toMediaRowId } from '@/lib/database/domains/media/rows'
import { parseAlbumCursor } from '@/lib/services/gallery/galleryAlbumQueries'
import { isOwnerGalleryAudience } from '@/lib/services/gallery/galleryAudience'
import { getGalleryMediaPage } from '@/lib/services/gallery/galleryQueries'
import { resolveGalleryAccount } from '@/lib/services/gallery/resolveGalleryAccount'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  GALLERY_MEDIA_SORTS,
  GALLERY_SHOWS,
  MEDIA_SUBJECT_CATEGORIES
} from '@/lib/types/database/gallery'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const isValidCalendarDate = (str: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
  if (!match) return false
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}

const GalleryMediaQueryParams = z.object({
  max_id: z.string().regex(/^\d+$/).max(10).optional(),
  limit: clampedLimit(60, 24),
  subject: z.string().trim().min(1).max(520).optional(),
  category: z.enum(MEDIA_SUBJECT_CATEGORIES).optional(),
  gear_id: z.string().max(255).optional(),
  // Owner only: `in_gallery` (default), `all` (posted or added in Gallery),
  // `hidden` (switched off in the gallery), `not_posted` (added, no post
  // yet) or `not_in_album` (posted or added, in no album). Anyone else is
  // always shown the gallery, whatever they send.
  show: z.enum(GALLERY_SHOWS).optional(),
  sort: z.enum(GALLERY_MEDIA_SORTS).optional(),
  cursor: z.string().max(40).optional(),
  taken_from: z.string().trim().optional(),
  taken_to: z.string().trim().optional(),
  // `none` is reserved for "no place": a place literally named "none" cannot
  // be selected by name (accepted limitation). Same for `activity_id=none`.
  place: z.string().trim().min(1).max(255).optional(),
  activity_id: z.string().trim().min(1).max(255).optional(),
  album_id: z.string().trim().min(1).max(255).optional(),
  // Owner only: `true` adds `total` / `inAlbumTotal` to the first page.
  include_total: z.enum(['true', 'false']).optional()
})

// The params that only the owner can use. Anyone else's copies are dropped
// before validation, so a visitor sending them gets what they always got.
const OWNER_ONLY_PARAMS = [
  'sort',
  'cursor',
  'taken_from',
  'taken_to',
  'place',
  'activity_id',
  'album_id',
  'include_total'
]

// GET /api/v1/accounts/:id/gallery/media — a page of the account's gallery
// photos as the requesting viewer may see them. For visitors, returns photos
// newest upload first (paged by max_id). For the owner, supports date sorts
// (`taken_desc`, `taken_asc`) paged by compound cursor, SQL filters (`place`,
// `taken_from`, `taken_to`, `activity_id`, `album_id`), `show` scoping, and
// `total` / `inAlbumTotal` counts on the first page when `include_total=true`.
// Those params are ignored for everyone else.
export const GET = traceApiRoute(
  'getAccountGalleryMedia',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      const { id: encodedAccountId } = await params
      if (!encodedAccountId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const resolved = await resolveGalleryAccount({
        database,
        encodedAccountId,
        currentActor
      })
      if (!resolved) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      const { owner, audience } = resolved

      const rawParams = Object.fromEntries(
        new URL(req.url).searchParams.entries()
      )
      if (!isOwnerGalleryAudience(audience)) {
        for (const key of OWNER_ONLY_PARAMS) delete rawParams[key]
      }
      const parsed = GalleryMediaQueryParams.safeParse(rawParams)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const {
        max_id: maxId,
        limit,
        subject,
        category,
        gear_id: gearId,
        show,
        sort,
        cursor,
        taken_from,
        taken_to,
        place,
        activity_id,
        album_id,
        include_total
      } = parsed.data

      // Gear ids are the owner's own bookkeeping; no one else may filter by one.
      if (gearId !== undefined && !isOwnerGalleryAudience(audience)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'gear_id is only available to the owner' },
          responseStatusCode: 422
        })
      }

      const isOwner = isOwnerGalleryAudience(audience)
      if (isOwner) {
        const isDateSort = sort === 'taken_desc' || sort === 'taken_asc'

        if (cursor !== undefined && !isDateSort) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'cursor is only supported for date sorts' },
            responseStatusCode: 422
          })
        }

        if (maxId !== undefined && isDateSort) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'max_id cannot be used with date sort' },
            responseStatusCode: 422
          })
        }

        // The media id is bound to an integer column; past PostgreSQL's range
        // it would be a 500, not a miss.
        const parsedCursor =
          cursor === undefined ? null : parseAlbumCursor(cursor)
        if (
          cursor !== undefined &&
          (!parsedCursor || toMediaRowId(String(parsedCursor.mediaId)) === null)
        ) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'Invalid cursor' },
            responseStatusCode: 422
          })
        }

        if (taken_from !== undefined && !isValidCalendarDate(taken_from)) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'Invalid taken_from date' },
            responseStatusCode: 422
          })
        }

        if (taken_to !== undefined && !isValidCalendarDate(taken_to)) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'Invalid taken_to date' },
            responseStatusCode: 422
          })
        }

        if (
          taken_from !== undefined &&
          taken_to !== undefined &&
          taken_from > taken_to
        ) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'taken_from cannot be after taken_to' },
            responseStatusCode: 422
          })
        }
      }

      const includeTotal =
        isOwner &&
        include_total === 'true' &&
        cursor === undefined &&
        maxId === undefined

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryMediaPage({
          database,
          owner,
          audience,
          maxId,
          limit,
          subjectKey: subject,
          category,
          gearId,
          show,
          ...(isOwner
            ? {
                sort,
                cursor,
                place,
                takenFrom: taken_from,
                takenTo: taken_to,
                activityId: activity_id,
                albumId: album_id,
                includeTotal
              }
            : null)
        })
      })
    },
    // `matchMode: 'any'` because a token may legally hold `read:statuses`
    // alone, and `errorResponse` so the guard's own rejections carry CORS
    // headers (see the sibling account media route).
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)

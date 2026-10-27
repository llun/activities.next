import { z } from 'zod'

import { toMediaRowId } from '@/lib/database/domains/media/rows'
import { parseAlbumCursor } from '@/lib/services/gallery/galleryAlbumQueries'
import { isOwnerGalleryAudience } from '@/lib/services/gallery/galleryAudience'
import { parseGalleryDayKey } from '@/lib/services/gallery/galleryEntities'
import {
  getGalleryMediaIds,
  getGalleryMediaPage
} from '@/lib/services/gallery/galleryQueries'
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
import {
  MAX_GALLERY_ALBUM_ITEMS,
  MAX_GALLERY_IDS_OFFSET
} from '@/lib/types/database/galleryAlbums'
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
  include_total: z.enum(['true', 'false']).optional(),
  // Owner only: `true` adds `days` (per-day stats of the days the page
  // spans) to the page.
  include_days: z.enum(['true', 'false']).optional(),
  // Owner only: answer `{ mediaIds }` — the ids of one day's matches —
  // instead of a page.
  ids_only: z.enum(['true']).optional(),
  // Owner only: the GalleryDayKey to select from an ids read or list page.
  day_key: z.string().max(30).optional()
})

// `ids_only` needs up to MAX_GALLERY_ALBUM_ITEMS ids (Select day), so its
// `limit` is capped there instead of the page cap of 60.
const GalleryMediaIdsQueryParams = GalleryMediaQueryParams.extend({
  limit: clampedLimit(MAX_GALLERY_ALBUM_ITEMS, MAX_GALLERY_ALBUM_ITEMS),
  // The whole-day read pages at most 25 times (50,000 ids), so an offset
  // past the maximum can only be a mistake.
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_GALLERY_IDS_OFFSET)
    .optional()
    .default(0)
})

// The params that only the owner can use. Anyone else's copies are dropped
// before validation, so a visitor sending them gets what they always got.
// `ids_only` is NOT here: it answers 422 for anyone else, like `gear_id`.
const OWNER_ONLY_PARAMS = [
  'sort',
  'cursor',
  'taken_from',
  'taken_to',
  'place',
  'activity_id',
  'album_id',
  'include_total',
  'include_days',
  'day_key',
  'offset'
]

// GET /api/v1/accounts/:id/gallery/media — a page of the account's gallery
// photos as the requesting viewer may see them. For visitors, returns photos
// newest upload first (paged by max_id). For the owner, supports date sorts
// (`taken_desc`, `taken_asc`) paged by compound cursor, SQL filters (`place`,
// `taken_from`, `taken_to`, `activity_id`, `album_id`), `show` scoping, and
// `total` / `inAlbumTotal` counts on the first page when `include_total=true`,
// plus `days` (per-day stats of the days the page spans) when
// `include_days=true`. An owner may use `day_key=<GalleryDayKey>` to restrict
// a list page to one day, or with `ids_only=true` to receive `{ mediaIds }`:
// that day's ids in `sort` order, minus the `album_id` album's members.
// Those params are ignored for everyone else, except `ids_only`, which answers
// 422 for a non-owner like `gear_id`.
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
      const isOwner = isOwnerGalleryAudience(audience)

      // The owner-only ids read is rejected for anyone else before the
      // owner-only strip (so it is never silently honoured), like `gear_id`.
      if ('ids_only' in rawParams && !isOwner) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'ids_only is only available to the owner' },
          responseStatusCode: 422
        })
      }

      if (!isOwner) {
        for (const key of OWNER_ONLY_PARAMS) delete rawParams[key]
      }
      const parsed = (
        rawParams.ids_only === 'true'
          ? GalleryMediaIdsQueryParams
          : GalleryMediaQueryParams
      ).safeParse(rawParams)
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
        include_total,
        include_days,
        ids_only,
        day_key
      } = parsed.data
      const offset =
        'offset' in parsed.data && typeof parsed.data.offset === 'number'
          ? parsed.data.offset
          : 0

      // Gear ids are the owner's own bookkeeping; no one else may filter by one.
      if (gearId !== undefined && !isOwner) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'gear_id is only available to the owner' },
          responseStatusCode: 422
        })
      }

      if (isOwner) {
        // Invalid date filters are 422 whatever the read: ahead of the
        // `ids_only` branch, so its early return cannot skip them.
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

        if (day_key !== undefined) {
          const parsedDayKey = parseGalleryDayKey(day_key)
          if (!parsedDayKey) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: 'Invalid day_key' },
              responseStatusCode: 422
            })
          }
          // An omitted sort is `uploaded` in both reads, so validate against
          // the effective sort rather than the raw param.
          if ((sort ?? 'uploaded') === 'uploaded' && !parsedDayKey.uploaded) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: 'day_key does not match sort' },
              responseStatusCode: 422
            })
          }
        }

        // The ids read: one day, same filters, offset paging, no cursor.
        if (ids_only === 'true') {
          if (day_key === undefined) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: 'day_key is required with ids_only' },
              responseStatusCode: 422
            })
          }
          if (cursor !== undefined || maxId !== undefined) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: 'ids_only takes no cursor' },
              responseStatusCode: 422
            })
          }

          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: await getGalleryMediaIds({
              database,
              owner,
              audience,
              limit,
              offset,
              subjectKey: subject,
              category,
              gearId,
              show,
              sort,
              place,
              takenFrom: taken_from,
              takenTo: taken_to,
              activityId: activity_id,
              dayKey: day_key,
              ...(album_id !== undefined ? { excludeAlbumId: album_id } : null)
            })
          })
        }

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
                dayKey: day_key,
                place,
                takenFrom: taken_from,
                takenTo: taken_to,
                activityId: activity_id,
                albumId: album_id,
                includeTotal,
                includeDays: include_days === 'true'
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

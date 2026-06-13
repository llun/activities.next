import { NextRequest } from 'next/server'

import {
  AnnouncementUpdateInput,
  getAdminAnnouncement,
  isoToStorageTime
} from '@/lib/services/announcements/adminAnnouncement'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.PUT,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const PUT = traceApiRoute(
  'adminUpdateAnnouncement',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params }) => {
      const { id } = await params
      let rawBody: unknown
      try {
        rawBody = await req.json()
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }
      const parsed = AnnouncementUpdateInput.safeParse(rawBody)
      if (!parsed.success)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const updated = await database.updateAnnouncement({
        id,
        text: parsed.data.text,
        startsAt: isoToStorageTime(parsed.data.starts_at),
        endsAt: isoToStorageTime(parsed.data.ends_at),
        allDay: parsed.data.all_day,
        published: parsed.data.published
      })
      if (!updated)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getAdminAnnouncement(updated)
      })
    }
  )
)

// Mastodon clients commonly send PATCH for updates; bind it to the same handler.
export const PATCH = PUT

export const DELETE = traceApiRoute(
  'adminDeleteAnnouncement',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const { id } = await params
    // deleteAnnouncement returns void and is idempotent, so check existence
    // first to distinguish an unknown id (404) from a real delete (200).
    const announcements = await database.getAnnouncements()
    const exists = announcements.some((announcement) => announcement.id === id)
    if (!exists)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    await database.deleteAnnouncement({ id })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  })
)

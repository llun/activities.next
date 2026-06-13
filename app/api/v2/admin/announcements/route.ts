import { NextRequest } from 'next/server'

import {
  AnnouncementCreateInput,
  getAdminAnnouncement,
  isoToStorageTime
} from '@/lib/services/announcements/adminAnnouncement'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListAnnouncements',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const announcements = await database.getAnnouncements()
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: announcements.map(getAdminAnnouncement)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateAnnouncement',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
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
    const parsed = AnnouncementCreateInput.safeParse(rawBody)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const announcement = await database.createAnnouncement({
      text: parsed.data.text,
      startsAt: isoToStorageTime(parsed.data.starts_at) ?? null,
      endsAt: isoToStorageTime(parsed.data.ends_at) ?? null,
      allDay: parsed.data.all_day,
      published: parsed.data.published
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getAdminAnnouncement(announcement)
    })
  })
)

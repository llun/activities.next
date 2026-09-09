// `toIdPathSegment` is the ONLY id transformation this module performs, and it
// only ever fires for a raw AP URI headed into a URL path segment. Every
// id-accepting route resolves a publicId, a legacy colon/`apurl_` id, or a raw
// URI, so re-encoding a client id here can only corrupt it — `urlToId` reads a
// UUIDv7 publicId as a bare host and hands back `<uuid>:`, which nothing can
// resolve. Ids in query params and JSON bodies go out verbatim.
import { toIdPathSegment } from '@/lib/utils/urlToId'

export interface FitnessCalendarDay {
  date: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
}

export const getFitnessCalendarData = async ({
  actorId,
  startDate,
  endDate,
  activityType
}: {
  actorId: string
  startDate: number
  endDate: number
  activityType?: string
}): Promise<FitnessCalendarDay[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-calendar`
  )
  url.searchParams.append('start_date', `${startDate}`)
  url.searchParams.append('end_date', `${endDate}`)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) return []
  return response.json()
}

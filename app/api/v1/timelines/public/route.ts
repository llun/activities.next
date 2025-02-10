import { getDatabase } from '@/lib/database'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Timeline } from '@/lib/services/timelines/types'
import { apiErrorResponse } from '@/lib/utils/response'

export const dynamic = 'force-dynamic'

export const GET = async () => {
  const database = getDatabase()
  if (!database) return apiErrorResponse(500)

  const statuses = await database.getTimeline({
    timeline: Timeline.LOCAL_PUBLIC
  })
  const mastodonStatuses = await Promise.all(
    statuses.map((status) => getMastodonStatus(database, status))
  )
  return Response.json(mastodonStatuses)
}

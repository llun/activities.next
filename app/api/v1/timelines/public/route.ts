import { Timeline } from '@/lib/services/timelines/types'
import { getStorage } from '@/lib/storage'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { apiErrorResponse } from '@/lib/utils/response'

export const dynamic = 'force-dynamic'

export const GET = async () => {
  const storage = await getStorage()
  if (!storage) return apiErrorResponse(500)

  const statuses = await storage.getTimeline({
    timeline: Timeline.LOCAL_PUBLIC
  })

  if (statuses.length === 0) {
    return Response.json([])
  }

  const loadedStatuses = await Promise.all(
    statuses.map(async (status) => ({
      id: status.id,
      created_at: getISOTimeUTC(status.createdAt),
      in_reply_to_id: null,
      in_reply_to_account_id: null,
      sensitive: false,
      spoiler_text: '',
      visibility: 'public',
      language: 'en',
      uri: status.id,
      url: status.url,
      replies_count: 0,
      reblogs_count: 0,
      favourites_count: 0,
      edited_at: null,
      content: status.content,
      reblog: null,
      mentions: [],
      tags: [],
      emojis: [],
      card: null,
      poll: null,
      account: {
        id: status.actor?.id,
        username: status.actor?.username,
        acct: `${status.actor?.username}@${status.actor?.domain}`,
        display_name: status.actor?.name,
        locked: false,
        bot: false,
        discoverable: true,
        group: false,
        created_at: getISOTimeUTC(status.actor?.createdAt ?? 0),
        note: status.actor?.summary,
        url: `https://${status.actor?.domain}/@${status.actor?.username}`,
        avatar: status.actor?.iconUrl,
        avatar_static: status.actor?.iconUrl,
        header: status.actor?.headerImageUrl,
        header_static: status.actor?.headerImageUrl,
        followers_count: status.actor?.followersCount ?? 0,
        following_count: status.actor?.followingCount ?? 0,
        statuses_count: status.actor?.statusCount ?? 0,
        last_status_at: status.actor?.lastStatusAt
          ? getISOTimeUTC(status.actor?.lastStatusAt)
          : null,
        emojis: [],
        fields: []
      },
      media_attachments: status.attachments.map((attachment) => ({
        id: attachment.id,
        type: attachment.mediaType,
        url: attachment.url,
        description: attachment.name
      }))
    }))
  )

  return Response.json(loadedStatuses)
}

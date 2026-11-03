import type { ActorVisibleStatusAudience } from '@/lib/database/kysely/visibility/actorVisible'
import type { Database } from '@/lib/database/types'
import { type Status, StatusType } from '@/lib/types/domain/status'

/**
 * Which of a page of an actor's statuses belong on the web profile's Replies
 * tab (see `getRepliesTabStatusIds` in
 * `lib/database/domains/status/repliesTab.ts`): the actor's replies whose
 * self-reply chain starts with a reply to someone else. Everything else is on
 * the Posts tab. Only the actor's own replies are asked about, so a page with
 * none sends no query.
 *
 * The web profile (`getProfileData` and `GET /api/v1/accounts/:id/statuses`
 * with `format=activities_next`) sends the ids beside the page; the Mastodon
 * response never carries them.
 */
export const getProfileRepliesTabStatusIds = async ({
  database,
  actorId,
  statuses,
  audience
}: {
  database: Database
  actorId: string
  statuses: Status[]
  audience: ActorVisibleStatusAudience
}): Promise<string[]> => {
  const replyIds = statuses
    .filter(
      (status) =>
        status.type !== StatusType.enum.Announce &&
        status.actorId === actorId &&
        Boolean(status.reply)
    )
    .map((status) => status.id)
  if (replyIds.length === 0) return []
  return database.getRepliesTabStatusIds({
    actorId,
    statusIds: replyIds,
    audience
  })
}

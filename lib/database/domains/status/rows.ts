import { parseStatusContent } from '@/lib/database/sql/utils/parseStatusContent'
import { Actor, ActorProfile, getActorProfile } from '@/lib/types/domain/actor'

// Row helpers the Kysely status domain shares with the Knex status deletion
// (lib/database/sql/status.ts).

// A status embeds its author for rendering only, and nothing reads the
// author's `lastStatusAt` there — yet it rides along on every page that ships
// statuses to the client (public SSR pages serialize them whole), where it
// would date the author's newest followers-only post to the millisecond. The
// account entity's date-only `last_status_at` is the one place it belongs.
export const getStatusActorProfile = (actor: Actor): ActorProfile => ({
  ...getActorProfile(actor),
  lastStatusAt: null
})

// The boosted status an Announce's `content` names: the id itself, or the
// `url` or `id` of a stored object.
export const getOriginalStatusIdFromAnnounceContent = (
  content: unknown
): string | null => {
  const parsed = parseStatusContent(content)
  if (!parsed) return null
  if (typeof parsed === 'string') {
    return parsed
  }
  if (typeof parsed.url === 'string' && parsed.url.length > 0) {
    return parsed.url
  }
  if (typeof parsed.id === 'string' && parsed.id.length > 0) {
    return parsed.id
  }
  return null
}

// The boosted status of an Announce row: `originalStatusId`, or for a row
// written before that column existed, the id in its `content`.
export const getAnnounceOriginalStatusId = ({
  content,
  originalStatusId
}: {
  content?: unknown
  originalStatusId?: string | null
}): string | null =>
  originalStatusId || getOriginalStatusIdFromAnnounceContent(content)

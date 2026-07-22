import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { Status, StatusAnnounce, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'

interface GetRemoteActorStatusesParams {
  database: Database
  actorId: string
  limit: number
  excludeReplies?: boolean
  excludeReblogs?: boolean
  onlyMedia?: boolean
}

// Live-fetch a remote actor's most recent posts from their outbox for the
// Mastodon statuses API. A remote actor's posts only exist locally once they
// federate here (e.g. after someone follows them), so a profile opened in a
// Mastodon client would otherwise show an empty timeline. The statuses are
// ephemeral — served for display, not persisted.
//
// Best-effort by design: any failure returns an empty list and the caller
// falls back to the locally-stored statuses.
export const getRemoteActorStatuses = async ({
  database,
  actorId,
  limit,
  excludeReplies = false,
  excludeReblogs = false,
  onlyMedia = false
}: GetRemoteActorStatusesParams): Promise<Status[]> => {
  try {
    // Server-to-server fetches are signed by the headless instance actor so
    // authorized-fetch ("secure mode") remotes accept them; a missing signer
    // degrades to an unsigned fetch. Independent of the federation policy
    // check, so resolve both concurrently.
    const [canFederate, signingActor] = await Promise.all([
      canFederateWithDomain(database, actorId),
      getFederationSigningActorSafe(database, 'for remote statuses')
    ])
    if (!canFederate) return []
    const signingParams = signingActor ? { signingActor } : {}

    const person = await getActorPerson({ actorId, ...signingParams })
    if (!person) return []

    const { statuses } = await getActorPosts({
      database,
      person,
      ...signingParams
    })

    // The Mastodon serializer resolves a reblog's author from the database, so
    // an Announce whose original author is unknown locally can't be rendered.
    // Keep only announces with locally-known original authors.
    // Remote data can be malformed: tolerate an Announce with a missing
    // original (or author) instead of letting one bad status abort the whole
    // fetch via the outer catch. Skipped entirely when the filter below drops
    // every Announce anyway (reblogs excluded, or media-only pages).
    const announceAuthorIds =
      excludeReblogs || onlyMedia
        ? []
        : [
            ...new Set(
              statuses
                .filter(
                  (status): status is StatusAnnounce =>
                    status.type === StatusType.enum.Announce &&
                    Boolean(status.originalStatus?.actorId)
                )
                .map((status) => status.originalStatus.actorId)
            )
          ]
    const knownAuthorIds = new Set(
      announceAuthorIds.length > 0
        ? (await database.getActorsFromIds({ ids: announceAuthorIds })).map(
            (actor) => actor.id
          )
        : []
    )

    return statuses
      .filter((status) => {
        // The outbox should only expose public/unlisted posts; enforce that
        // here so a misbehaving remote can't slip restricted posts into the
        // response.
        const visibility = getVisibility(status.to, status.cc)
        if (visibility !== 'public' && visibility !== 'unlisted') return false

        if (status.type === StatusType.enum.Announce) {
          // The media tab shows the actor's own media posts, never boosts —
          // matching getActorStatuses' only_media handling on the local path.
          if (excludeReblogs || onlyMedia) return false
          return Boolean(
            status.originalStatus?.actorId &&
            knownAuthorIds.has(status.originalStatus.actorId)
          )
        }
        if (excludeReplies && status.reply) return false
        if (onlyMedia && status.attachments.length === 0) return false
        return true
      })
      .slice(0, limit)
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch remote actor statuses from outbox',
      actorId,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

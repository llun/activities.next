import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Status, StatusType } from '@/lib/types/domain/status'
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
    if (!(await canFederateWithDomain(database, actorId))) return []

    // Server-to-server fetches are signed by the headless instance actor so
    // authorized-fetch ("secure mode") remotes accept them; a missing signer
    // degrades to an unsigned fetch.
    const signingActor = await getFederationSigningActor(database).catch(
      (error) => {
        logger.warn({
          message:
            'Failed to resolve federation signing actor for remote statuses; falling back to an unsigned request',
          error: error instanceof Error ? error.message : String(error)
        })
        return undefined
      }
    )
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
    const announceAuthorIds = [
      ...new Set(
        statuses
          .filter((status) => status.type === StatusType.enum.Announce)
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
          if (excludeReblogs) return false
          return knownAuthorIds.has(status.originalStatus.actorId)
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

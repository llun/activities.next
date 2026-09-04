import { getNote } from '@/lib/activities'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { BaseNote, BaseNoteSchema } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { isPixelfedActor } from '@/lib/services/federation/serverSoftware'
import { detectLanguageFromHtml } from '@/lib/services/language-detection'
import { Actor } from '@/lib/types/activitypub'
import {
  Announce,
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { ActorProfile, Actor as DomainActor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  fromAnnounce,
  fromNote
} from '@/lib/types/domain/status'
import {
  isSameActivityPubOrigin,
  normalizeActivityPubAnnounce,
  normalizeActivityPubContent
} from '@/lib/utils/activitypub'
import {
  getActorProfileFromPerson,
  isOpaqueActorUsername
} from '@/lib/utils/activitypubActor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

import { getActorCollections } from './getActorCollections'
import { getActorPerson } from './getActorPerson'
import { getActorPostsFromAtomFeed } from './getActorPostsFromAtomFeed'
import { getPixelfedPosts } from './getPixelfedPosts'

type GetActorPostsFunction = (params: {
  database: Database
  person: Actor
  signingActor?: DomainActor
  pageUrl?: string
}) => Promise<{
  statusesCount: number | null
  statuses: Status[]
  nextPageUrl: string | null
  prevPageUrl: string | null
}>

const getStatusFromNote = (note: BaseNote) => {
  try {
    const status = fromNote(note)
    // Ephemeral status (not persisted), so content-detected language is
    // computed here rather than read from status_detected_languages.
    status.detectedLanguage =
      detectLanguageFromHtml(status.text)?.language ?? null
    return status
  } catch (error) {
    logger.error({
      message: 'Fail to convert note to status',
      err: toLoggableError(error)
    })
    return null
  }
}

export const getActorPosts: GetActorPostsFunction = async ({
  database,
  person,
  signingActor,
  pageUrl
}) =>
  withSpan(
    'activity',
    'getActorPosts',
    {
      actorId: person.id
    },
    async () => {
      const actor = await database.getActorFromId({ id: person.id })
      const actorProfileCache = new Map<string, Promise<ActorProfile | null>>()
      const getActorProfile = (actorId: string) => {
        let actorProfile = actorProfileCache.get(actorId)
        if (!actorProfile) {
          actorProfile = (async () => {
            const persistedActor = await database.getActorFromId({
              id: actorId
            })
            if (
              persistedActor &&
              !isOpaqueActorUsername(actorId, persistedActor.username)
            ) {
              return ActorProfile.parse(persistedActor)
            }

            const actorPerson = await getActorPerson({
              actorId,
              signingActor
            })
            if (!actorPerson) {
              return persistedActor ? ActorProfile.parse(persistedActor) : null
            }

            return getActorProfileFromPerson(actorPerson)
          })()
          actorProfileCache.set(actorId, actorProfile)
        }

        return actorProfile
      }

      const value = await getActorCollections({
        person,
        field: 'outbox',
        signingActor,
        pageUrl
      })
      if (!value) {
        return {
          statusesCount: null,
          statuses: [],
          nextPageUrl: null,
          prevPageUrl: null
        }
      }

      const items = value.page?.orderedItems ?? []
      const statuses = await Promise.all(
        items.map(async (item) => {
          // This should be impossible for status api
          if (typeof item === 'string') return null

          // Canonicalise the activity (and any embedded object) via JSON-LD
          // compaction before validating, so dialect variations in `type`,
          // recipients and id references collapse to a predictable shape.
          const activity = await compactActivityPub(item)

          if (activity.type === AnnounceAction) {
            const announceResult = Announce.safeParse(
              normalizeActivityPubAnnounce(activity)
            )
            if (!announceResult.success) return null

            const announce = announceResult.data
            const localStatus = await database.getStatus({
              statusId: announce.object
            })

            let originalStatus =
              localStatus?.type !== StatusType.enum.Announce
                ? localStatus
                : null

            if (!originalStatus) {
              const note = await getNote({
                statusId: announce.object,
                signingActor
              })
              if (!note || !isSameActivityPubOrigin(announce.object, note.id)) {
                return null
              }

              const noteResult = BaseNoteSchema.safeParse(
                normalizeActivityPubContent(note)
              )
              if (!noteResult.success) return null

              originalStatus = getStatusFromNote(noteResult.data)
              if (!originalStatus) return null
            }

            const originalStatusWithActor = {
              ...originalStatus,
              actor: await getActorProfile(originalStatus.actorId)
            }
            const announceStatus = fromAnnounce(
              announce,
              originalStatusWithActor
            )
            if (actor) announceStatus.actor = actor
            return announceStatus
          }

          // Unsupported activity
          if (activity.type !== CreateAction) return null
          // Unsupported Object
          if (!activity.object) return null

          let rawObject: unknown = activity.object
          if (typeof rawObject === 'string') {
            const localStatus = await database.getStatus({
              statusId: rawObject
            })
            if (localStatus && localStatus.type !== StatusType.enum.Announce) {
              if (actor) localStatus.actor = actor
              return localStatus
            }
            const fetchedNote = await getNote({
              statusId: rawObject,
              signingActor
            })
            if (
              !fetchedNote ||
              !isSameActivityPubOrigin(rawObject, fetchedNote.id)
            ) {
              return null
            }
            rawObject = fetchedNote
          }

          if (!rawObject || typeof rawObject !== 'object') return null
          const noteResult = BaseNoteSchema.safeParse(
            normalizeActivityPubContent(rawObject as Record<string, unknown>)
          )
          if (!noteResult.success) return null

          const status = getStatusFromNote(noteResult.data)
          if (!status) return null

          if (actor) status.actor = actor
          return status
        })
      )

      let validStatuses: Status[] = statuses.filter(
        (item): item is NonNullable<typeof item> => item !== null
      )

      if (validStatuses.length === 0) {
        const isPixelfed = await isPixelfedActor(person)
        if (isPixelfed) {
          try {
            const pixelfedResult = await getPixelfedPosts({
              person,
              pageUrl,
              actor
            })
            if (pixelfedResult && pixelfedResult.statuses.length > 0) {
              return pixelfedResult
            }
          } catch (err) {
            logger.warn({
              message:
                'Failed to fetch Pixelfed posts via API, falling back to Atom feed',
              actorId: person.id,
              err: toLoggableError(err)
            })
          }

          if (!pageUrl) {
            validStatuses = await getActorPostsFromAtomFeed({
              person,
              signingActor,
              actor
            })
          }
        }
      }

      return {
        statusesCount: value.totalItems,
        statuses: validStatuses,
        nextPageUrl: value.page?.next ?? null,
        prevPageUrl: value.page?.prev ?? null
      }
    }
  )

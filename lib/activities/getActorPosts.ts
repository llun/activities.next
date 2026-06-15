import { getNote } from '@/lib/activities'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/activitypub'
import {
  Announce,
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { Note } from '@/lib/types/activitypub/objects'
import { ActorProfile, Actor as DomainActor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  fromAnnounce,
  fromNote
} from '@/lib/types/domain/status'
import {
  normalizeActivityPubAnnounce,
  normalizeActivityPubContent
} from '@/lib/utils/activitypub'
import {
  getActorProfileFromPerson,
  isOpaqueActorUsername
} from '@/lib/utils/activitypubActor'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

import { getActorCollections } from './getActorCollections'
import { getActorPerson } from './getActorPerson'

type GetActorPostsFunction = (params: {
  database: Database
  person: Actor
  signingActor?: DomainActor
  pageUrl?: string
}) => Promise<{
  statusesCount: number
  statuses: Status[]
  nextPageUrl: string | null
  prevPageUrl: string | null
}>

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const getStatusFromNote = (note: Note) => {
  try {
    return fromNote(note)
  } catch (error) {
    logger.error(`[getActorPosts] ${getErrorMessage(error)}`)
    return null
  }
}

export const getActorPosts: GetActorPostsFunction = async ({
  database,
  person,
  signingActor,
  pageUrl
}) =>
  getTracer().startActiveSpan(
    'activities.getActorPosts',
    {
      attributes: { actorId: person.id }
    },
    async (span) => {
      try {
        const actor = await database.getActorFromId({ id: person.id })
        const actorProfileCache = new Map<
          string,
          Promise<ActorProfile | null>
        >()
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
                return persistedActor
                  ? ActorProfile.parse(persistedActor)
                  : null
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
            statusesCount: 0,
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
            const activity = (await compactActivityPub(item)) as {
              type?: string
              object?: unknown
              [key: string]: unknown
            }

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
                if (!note) return null

                const noteResult = Note.safeParse(
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
            if (!activity.object || typeof activity.object === 'string')
              return null
            const obj = activity.object as {
              type?: string
              [key: string]: unknown
            }
            if (obj.type !== 'Note') return null

            const noteResult = Note.safeParse(normalizeActivityPubContent(obj))
            if (!noteResult.success) return null

            const status = getStatusFromNote(noteResult.data)
            if (!status) return null

            if (actor) status.actor = actor
            return status
          })
        )

        return {
          statusesCount: value.totalItems ?? 0,
          statuses: statuses.filter((item) => item !== null),
          nextPageUrl: value.page?.next ?? null,
          prevPageUrl: value.page?.prev ?? null
        }
      } finally {
        span.end()
      }
    }
  )

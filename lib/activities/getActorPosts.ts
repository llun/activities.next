import { getNote } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/activitypub'
import {
  Announce,
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { Note } from '@/lib/types/activitypub/objects'
import { ActorProfile, Actor as DomainActor } from '@/lib/types/domain/actor'
import { Status, fromAnnoucne, fromNote } from '@/lib/types/domain/status'
import {
  normalizeActivityPubAnnounce,
  normalizeActivityPubContent
} from '@/lib/utils/activitypub'
import {
  getActorProfileFromPerson,
  isOpaqueActorUsername
} from '@/lib/utils/activitypubActor'
import { getTracer } from '@/lib/utils/trace'

import { getActorCollections } from './getActorCollections'
import { getActorPerson } from './getActorPerson'

type GetActorPostsFunction = (params: {
  database: Database
  person: Actor
  signingActor?: DomainActor
}) => Promise<{
  statusesCount: number
  statuses: Status[]
}>

const getStatusFromNote = (note: Note) => {
  try {
    return fromNote(note)
  } catch {
    return null
  }
}

export const getActorPosts: GetActorPostsFunction = async ({
  database,
  person,
  signingActor
}) =>
  getTracer().startActiveSpan(
    'activities.getActorPosts',
    {
      attributes: { actorId: person.id }
    },
    async (span) => {
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
        signingActor
      })
      if (!value) {
        span.end()
        return { statusesCount: 0, statuses: [] }
      }

      const items = value.page?.orderedItems ?? []
      const statuses = await Promise.all(
        items.map(async (item) => {
          // This should be impossible for status api
          if (typeof item === 'string') return null
          if (item.type === AnnounceAction) {
            const announceResult = Announce.safeParse(
              normalizeActivityPubAnnounce(item)
            )
            if (!announceResult.success) return null

            const announce = announceResult.data
            const localStatus = await database.getStatus({
              statusId: announce.object
            })
            if (localStatus) return localStatus

            const note = await getNote({
              statusId: announce.object,
              signingActor
            })
            if (!note) return null

            const noteResult = Note.safeParse(normalizeActivityPubContent(note))
            if (!noteResult.success) return null

            const originalStatus = getStatusFromNote(noteResult.data)
            if (!originalStatus) return null

            originalStatus.actor = await getActorProfile(originalStatus.actorId)
            const announceStatus = fromAnnoucne(announce, originalStatus)
            if (actor) announceStatus.actor = actor
            return announceStatus
          }

          // Unsupported activity
          if (item.type !== CreateAction) return null
          // Unsupported Object
          if (!item.object || typeof item.object === 'string') return null
          const obj = item.object as { type?: string; [key: string]: unknown }
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
        statuses: statuses.filter((item) => item !== null)
      }
    }
  )

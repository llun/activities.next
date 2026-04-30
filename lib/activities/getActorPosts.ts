import { getNote } from '@/lib/activities'
import { AnnounceStatus } from '@/lib/activities/announceStatus'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/activitypub'
import {
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { Note } from '@/lib/types/activitypub/objects'
import { ActorProfile, Actor as DomainActor } from '@/lib/types/domain/actor'
import { Status, fromAnnoucne, fromNote } from '@/lib/types/domain/status'
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

const getActorDomain = (actorId: string) => {
  try {
    return new URL(actorId).host
  } catch {
    return actorId
  }
}

const getActorIdUsername = (actorId: string) =>
  decodeURIComponent(actorId.split('/').filter(Boolean).pop() || actorId)
    .replace(/^@+/, '')
    .trim()

const isOpaqueActorUsername = (actorId: string, username: string) => {
  const actorIdUsername = getActorIdUsername(actorId)
  return (
    username === actorIdUsername &&
    (username.startsWith('did:') ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(username))
  )
}

const getImageUrl = (image: Actor['icon']) => {
  if (!image) return undefined
  if (Array.isArray(image)) return image.find((item) => item.url)?.url
  return image.url
}

const getActorProfileFromPerson = (person: Actor): ActorProfile =>
  ActorProfile.parse({
    id: person.id,
    username: person.preferredUsername,
    domain: getActorDomain(person.id),
    name: person.name,
    summary: person.summary || undefined,
    iconUrl: getImageUrl(person.icon),
    headerImageUrl: getImageUrl(person.image),
    manuallyApprovesFollowers: person.manuallyApprovesFollowers,
    followersUrl: person.followers || `${person.id}/followers`,
    inboxUrl: person.inbox,
    sharedInboxUrl: person.endpoints?.sharedInbox || '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: person.published ? new Date(person.published).getTime() : 0
  })

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
            if (!item.object || typeof item.object !== 'string') return null
            const localStatus = await database.getStatus({
              statusId: item.object
            })
            if (localStatus) return localStatus

            const note = await getNote({
              statusId: item.object,
              signingActor
            })
            if (!note) return null
            const originalStatus = fromNote(note)
            originalStatus.actor = await getActorProfile(originalStatus.actorId)
            const announceStatus = fromAnnoucne(
              item as unknown as AnnounceStatus,
              originalStatus
            )
            if (actor) announceStatus.actor = actor
            return announceStatus
          }

          // Unsupported activity
          if (item.type !== CreateAction) return null
          // Unsupported Object
          if (!item.object || typeof item.object === 'string') return null
          const obj = item.object as { type?: string; [key: string]: unknown }
          if (obj.type !== 'Note') return null

          const status = fromNote(obj as unknown as Note)
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

import { Actor } from '@llun/activities.schema'

import { getNote } from '@/lib/activities'
import { AnnounceAction, CreateAction } from '@/lib/activities/actions/types'
import { Database } from '@/lib/database/types'
import { Status, fromAnnoucne, fromNote } from '@/lib/models/status'
import { getTracer } from '@/lib/utils/trace'

import { getActorCollections } from './getActorCollections'

type GetActorPostsFunction = (params: {
  database: Database
  person: Actor
}) => Promise<{
  statusesCount: number
  statuses: Status[]
}>

export const getActorPosts: GetActorPostsFunction = async ({
  database,
  person
}) =>
  getTracer().startActiveSpan(
    'activities.getActorPosts',
    {
      attributes: { actorId: person.id }
    },
    async (span) => {
      const actor = await database.getActorFromId({ id: person.id })
      const value = await getActorCollections({
        person,
        field: 'outbox'
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
            const localStatus = await database.getStatus({
              statusId: item.object
            })
            if (localStatus) return localStatus

            const note = await getNote({ statusId: item.object })
            if (!note) return null
            const originalStatus = fromNote(note)
            if (actor) originalStatus.actor = actor
            return fromAnnoucne(item, originalStatus)
          }

          // Unsupported activity
          if (item.type !== CreateAction) return null
          // Unsupported Object
          if (item.object.type !== 'Note') return null

          const status = fromNote(item.object)
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

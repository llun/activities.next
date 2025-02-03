import { Person } from '@llun/activities.schema'

import { getNote } from '@/lib/activities'
import { AnnounceAction, CreateAction } from '@/lib/activities/actions/types'
import { DEFAULT_ACCEPT } from '@/lib/activities/consts'
import {
  OrderedCollection,
  getOrderCollectionFirstPage
} from '@/lib/activities/entities/orderedCollection'
import { OrderedCollectionPage } from '@/lib/activities/entities/orderedCollectionPage'
import { Database } from '@/lib/database/types'
import { fromAnnoucne, fromNote } from '@/lib/models/status'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

interface Params {
  database: Database
  person: Person
}
export const getActorPosts = async ({ database, person }: Params) =>
  getTracer().startActiveSpan(
    'activities.getActorPosts',
    {
      attributes: { actorId: person.id }
    },
    async (span) => {
      const outboxResponse = await request({
        url: `${person.outbox}?page=true`,
        headers: { Accept: DEFAULT_ACCEPT }
      })
      if (outboxResponse.statusCode !== 200) {
        span.setAttributes({
          url: person.outbox,
          status: outboxResponse.statusCode
        })
        span.recordException(
          new Error(`Outbox URL returns ${outboxResponse.statusCode}`)
        )
        span.end()
        return []
      }

      console.log(outboxResponse.body)
      return []
      const outboxCollection = JSON.parse(
        outboxResponse.body
      ) as OrderedCollection
      const postsUrl = getOrderCollectionFirstPage(outboxCollection)

      if (!postsUrl) {
        span.recordException(
          new Error('Outbox response doesn not contain posts url')
        )
        span.end()
        return []
      }

      try {
        const postsResponse = await request({
          url: postsUrl,
          headers: { Accept: DEFAULT_ACCEPT }
        })
        if (postsResponse.statusCode !== 200) {
          span.setAttributes({
            url: postsUrl,
            status: postsResponse.statusCode
          })
          span.recordException(
            new Error(`Posts URL returns ${postsResponse.statusCode}`)
          )
          return []
        }

        const json: OrderedCollectionPage = JSON.parse(postsResponse.body)
        const items = json.orderedItems || []
        const statuses = await Promise.all(
          items.map(async (item) => {
            if (item.type === AnnounceAction) {
              const localStatus = await database.getStatus({
                statusId: item.object
              })
              if (localStatus) return localStatus

              const note = await getNote({ statusId: item.object })
              if (!note) return null
              const originalStatus = fromNote(note)
              return fromAnnoucne(item, originalStatus)
            }

            // Unsupported activity
            if (item.type !== CreateAction) return null
            // Unsupported Object
            if (item.object.type !== 'Note') return null

            return fromNote(item.object)
          })
        )

        return statuses.filter((item) => item !== null)
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getActorPosts] ${nodeError.message}`)
        return []
      } finally {
        span.end()
      }
    }
  )

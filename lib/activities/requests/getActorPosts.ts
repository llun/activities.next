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
import { Status, fromAnnoucne, fromNote } from '@/lib/models/status'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

interface Params {
  database: Database
  person: Person
}

interface Response {
  totalStatusesCount: number
  statuses: Status[]
}

export const getActorPosts = async ({
  database,
  person
}: Params): Promise<Response> =>
  getTracer().startActiveSpan(
    'activities.getActorPosts',
    {
      attributes: { actorId: person.id }
    },
    async (span) => {
      const outboxResponse = await request({
        url: person.outbox,
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
        return { totalStatusesCount: 0, statuses: [] }
      }

      const outboxCollection = JSON.parse(
        outboxResponse.body
      ) as OrderedCollection
      const totalItems = outboxCollection.totalItems ?? 0
      const postsUrl = getOrderCollectionFirstPage(outboxCollection)

      if (!postsUrl) {
        span.recordException(
          new Error('Outbox response doesn not contain posts url')
        )
        span.end()
        return { totalStatusesCount: totalItems, statuses: [] }
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
          return { totalStatusesCount: totalItems, statuses: [] }
        }

        const json: OrderedCollectionPage = JSON.parse(postsResponse.body)
        const items = json.orderedItems ?? []
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

        return {
          totalStatusesCount: totalItems,
          statuses: statuses.filter((item) => item !== null)
        }
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getActorPosts] ${nodeError.message}`)
        return { totalStatusesCount: 0, statuses: [] }
      } finally {
        span.end()
      }
    }
  )

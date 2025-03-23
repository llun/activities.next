import { Actor } from '@llun/activities.schema'

import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import {
  OrderedCollection,
  getOrderCollectionFirstPage
} from '@/lib/activities/entities/orderedCollection'
import { OrderedCollectionPage } from '@/lib/activities/entities/orderedCollectionPage'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

interface Params {
  person: Actor
  field: 'following' | 'followers' | 'outbox'
}

export const getActorCollections = async ({ person, field }: Params) =>
  getTracer().startActiveSpan(
    `activities.${field}`,
    {
      attributes: { actorId: person.id, field }
    },
    async (span) => {
      if (!person[field]) {
        span.recordException(new Error(`Person ${field} is undefined`))
        span.end()
        return null
      }

      const fieldResponse = await request({
        url: person[field],
        headers: { Accept: DEFAULT_ACCEPT }
      })
      if (fieldResponse.statusCode !== 200) {
        span.setAttributes({
          url: person[field],
          status: fieldResponse.statusCode
        })
        span.recordException(
          new Error(`Person ${field} returns ${fieldResponse.statusCode}`)
        )
        span.end()
        return null
      }

      const collection = JSON.parse(fieldResponse.body) as OrderedCollection
      const pageUrl = getOrderCollectionFirstPage(collection)
      if (!pageUrl) {
        span.recordException(
          new Error(`Person ${field} does not contain page url`)
        )
        span.end()
        return null
      }

      try {
        const response = await request({
          url: pageUrl,
          headers: { Accept: DEFAULT_ACCEPT }
        })
        if (response.statusCode !== 200) {
          span.setAttributes({
            url: pageUrl,
            status: response.statusCode
          })
          span.recordException(
            new Error(
              `Person ${field} with page returns ${fieldResponse.statusCode}`
            )
          )
          return null
        }
        return {
          page: JSON.parse(response.body) as OrderedCollectionPage,
          totalItems: collection.totalItems ?? 0
        }
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getActorCollections.${field}] ${nodeError.message}`)
        return { statusesCount: 0, statuses: [] }
      } finally {
        span.end()
      }
    }
  )

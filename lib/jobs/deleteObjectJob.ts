import { Announce, Tombstone } from '@llun/activities.schema'

import { normalizeActivityPubAnnounce } from '../utils/activitypub'
import { getTracer } from '../utils/trace'
import { createJobHandle } from './createJobHandle'
import { DELETE_OBJECT_JOB_NAME } from './names'

export const deleteObjectJob = createJobHandle(
  DELETE_OBJECT_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('deleteObject', async (span) => {
      const data = message.data
      if (typeof data === 'string') {
        span.setAttribute('actorId', data)
        await database.deleteActor({
          actorId: data
        })
        span.end()
        return
      }

      const tombStoneResult = Tombstone.safeParse(data)
      if (tombStoneResult.success) {
        const tombStone = tombStoneResult.data
        span.setAttribute('statusId', tombStone.id)
        await database.deleteStatus({
          statusId: tombStone.id
        })
        span.end()
        return
      }

      const announceResult = Announce.safeParse(
        normalizeActivityPubAnnounce(data)
      )
      if (announceResult.success) {
        const announce = announceResult.data
        span.setAttribute('statusId', announce.id)
        await database.deleteStatus({
          statusId: announce.id
        })
        span.end()
        return
      }

      span.recordException(new Error('Invalid data'))
      span.setAttribute('data', JSON.stringify(data))
      span.end()
    })
  }
)

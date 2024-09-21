import { Tombstone } from '@llun/activities.schema'

import { getTracer } from '../utils/trace'
import { createJobHandle } from './createJobHandle'
import { DELETE_OBJECT_JOB_NAME } from './names'

export const deleteObjectJob = createJobHandle(
  DELETE_OBJECT_JOB_NAME,
  async (storage, message) => {
    const data = message.data
    if (typeof data === 'string') {
      await getTracer().startActiveSpan('deleteUser', async (span) => {
        span.setAttribute('actorId', data)
        await storage.deleteActor({
          actorId: data
        })
      })
      return
    }

    const tombStone = Tombstone.parse(data)
    await getTracer().startActiveSpan('deleteStatus', async (span) => {
      span.setAttribute('statusId', tombStone.id)
      await storage.deleteStatus({
        statusId: tombStone.id
      })
    })
  }
)

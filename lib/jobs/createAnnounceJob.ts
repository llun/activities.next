import { Announce } from '@llun/activities.schema'
import { z } from 'zod'

import { recordActorIfNeeded } from '../actions/utils'
import { getStatus } from '../activities'
import { createJobHandle, getQueue } from '../services/queue'
import { JobHandle } from '../services/queue/type'
import { addStatusToTimelines } from '../services/timelines'
import { compact } from '../utils/jsonld'

export const CREATE_ANNOUNCE_JOB_NAME = 'CreateAnnounceJob'
export const CreateAnnounceJobMessage = z.object({
  name: z.literal(CREATE_ANNOUNCE_JOB_NAME),
  data: Announce
})
export type CreateAnnounceJobMessage = z.infer<typeof CreateAnnounceJobMessage>

export const createAnnounceJob: JobHandle = createJobHandle(
  CREATE_ANNOUNCE_JOB_NAME,
  async (storage, message) => {
    if (message.name !== CREATE_ANNOUNCE_JOB_NAME) return

    const status = message.data
    const compactedStatus = (await compact(status)) as Announce
    const { object } = compactedStatus

    const existingStatus = await storage.getStatus({
      statusId: object,
      withReplies: false
    })
    if (!existingStatus) {
      const boostedStatus = await getStatus({ statusId: object })
      if (!boostedStatus) {
        return
      }

      await getQueue().publish({ name: 'CreateNoteJob', data: boostedStatus })
    }

    const existingAnnounce = await storage.getStatus({
      statusId: compactedStatus.id,
      withReplies: false
    })
    if (existingAnnounce) {
      return
    }
    const [, announce] = await Promise.all([
      recordActorIfNeeded({ actorId: compactedStatus.actor, storage }),
      storage.createAnnounce({
        id: compactedStatus.id,
        actorId: compactedStatus.actor,
        to: Array.isArray(status.to)
          ? status.to
          : [status.to].filter((item) => item),
        cc: Array.isArray(status.cc)
          ? status.cc
          : [status.cc].filter((item) => item),
        originalStatusId: object
      })
    ])
    if (!announce) {
      return
    }
    await addStatusToTimelines(storage, announce)
  }
)

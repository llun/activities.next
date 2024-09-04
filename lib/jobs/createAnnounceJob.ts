import { Announce } from '@llun/activities.schema'

import { recordActorIfNeeded } from '../actions/utils'
import { getStatus } from '../activities'
import { JobHandle } from '../services/queue/type'
import { addStatusToTimelines } from '../services/timelines'
import { compact } from '../utils/jsonld'
import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'
import { CREATE_NOTE_JOB_NAME, createNoteJob } from './createNoteJob'

export const CREATE_ANNOUNCE_JOB_NAME = 'CreateAnnounceJob'
export const createAnnounceJob: JobHandle = createJobHandle(
  CREATE_ANNOUNCE_JOB_NAME,
  async (storage, message) => {
    const status = Announce.parse(message.data)
    const compactedStatus = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...status
    })) as Announce
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
      await createNoteJob(storage, {
        id: boostedStatus.id,
        name: CREATE_NOTE_JOB_NAME,
        data: boostedStatus
      })
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

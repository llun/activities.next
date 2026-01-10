import { Announce } from '@llun/activities.schema'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getNote } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { JobHandle } from '@/lib/services/queue/type'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { normalizeActivityPubAnnounce } from '@/lib/utils/activitypub'

export const createAnnounceJob: JobHandle = createJobHandle(
  CREATE_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    const status = Announce.parse(normalizeActivityPubAnnounce(message.data))

    let object: string
    if (typeof status.object === 'string') {
      object = status.object
    } else if (
      status.object &&
      typeof (status.object as { id?: unknown }).id === 'string'
    ) {
      object = (status.object as { id: string }).id
    } else {
      return
    }

    const existingStatus = await database.getStatus({
      statusId: object,
      withReplies: false
    })
    if (!existingStatus) {
      const boostedStatus = await getNote({ statusId: object })
      if (!boostedStatus) {
        return
      }
      await createNoteJob(database, {
        id: boostedStatus.id,
        name: CREATE_NOTE_JOB_NAME,
        data: boostedStatus
      })
    }
    const existingAnnounce = await database.getStatus({
      statusId: status.id,
      withReplies: false
    })
    if (existingAnnounce) {
      return
    }
    const [, announce] = await Promise.all([
      recordActorIfNeeded({ actorId: status.actor, database }),
      database.createAnnounce({
        id: status.id,
        actorId: status.actor,
        to: Array.isArray(status.to)
          ? status.to
          : [status.to].filter(
              (item): item is string => typeof item === 'string' && item !== ''
            ),
        cc: Array.isArray(status.cc)
          ? status.cc
          : [status.cc].filter(
              (item): item is string => typeof item === 'string' && item !== ''
            ),
        originalStatusId: object
      })
    ])
    if (!announce) {
      return
    }
    await addStatusToTimelines(database, announce)
  }
)

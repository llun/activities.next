import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { ENTITY_TYPE_NOTE, Note } from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { CREATE_POLL_VOTE_JOB_NAME } from './names'
import { actorMatchesVerifiedSender } from './verifiedSender'

// Poll vote notes have a 'name' field that's not in the standard Note schema
interface PollVoteData {
  name?: string
}

export const createPollVoteJob = createJobHandle(
  CREATE_POLL_VOTE_JOB_NAME,
  async (database, message) => {
    const normalizedData = normalizeActivityPubContent(message.data)
    const rawData = normalizedData as PollVoteData
    const voteName = rawData?.name

    const parseResult = Note.safeParse(normalizedData)
    if (!parseResult.success) {
      return
    }
    const note = parseResult.data

    if (note.type !== ENTITY_TYPE_NOTE) {
      return
    }

    if (!actorMatchesVerifiedSender(note.attributedTo, message)) {
      return
    }

    if (!note.inReplyTo || !voteName || note.content) {
      return
    }

    const pollStatus = await database.getStatus({
      statusId: note.inReplyTo,
      withReplies: false
    })

    if (!pollStatus || pollStatus.type !== StatusType.enum.Poll) {
      return
    }

    if (Date.now() > pollStatus.endAt) {
      return
    }

    const choiceIndex = pollStatus.choices.findIndex(
      (choice) => choice.title === voteName
    )

    if (choiceIndex === -1) {
      return
    }

    await assertActorCanFederate({
      actorId: note.attributedTo,
      database
    })

    await recordActorIfNeeded({
      actorId: note.attributedTo,
      database
    })

    try {
      const votesRecorded = await database.recordPollVotes({
        statusId: pollStatus.id,
        actorId: note.attributedTo,
        choices: [choiceIndex],
        allowAdditionalChoices: pollStatus.pollType === 'anyOf'
      })
      if (!votesRecorded) return
    } catch (error) {
      logger.error({ error }, 'Vote creation failed')
      throw error
    }
  }
)

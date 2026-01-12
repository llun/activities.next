import { ENTITY_TYPE_NOTE, Note } from '@llun/activities.schema'

import { recordActorIfNeeded } from '../actions/utils'
import { StatusType } from '../models/status'
import { normalizeActivityPubContent } from '../utils/activitypub'
import { createJobHandle } from './createJobHandle'
import { CREATE_POLL_VOTE_JOB_NAME } from './names'

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

    await recordActorIfNeeded({
      actorId: note.attributedTo,
      database
    })

    const hasVoted = await database.hasActorVoted({
      statusId: pollStatus.id,
      actorId: note.attributedTo
    })

    if (pollStatus.pollType === 'oneOf' && hasVoted) {
      return
    }

    try {
      await database.createPollAnswer({
        statusId: pollStatus.id,
        actorId: note.attributedTo,
        choice: choiceIndex
      })

      await database.incrementPollChoiceVotes({
        statusId: pollStatus.id,
        choiceIndex
      })
    } catch (error) {
      console.error('Vote creation failed:', error)
    }
  }
)

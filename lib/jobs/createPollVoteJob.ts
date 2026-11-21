import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { canActorReadStatus } from '@/lib/services/statusAccess'
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
      logger.warn({
        message: 'Dropping malformed poll vote payload',
        job: CREATE_POLL_VOTE_JOB_NAME,
        statusId: (message.data as { id?: unknown } | null)?.id
      })
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

    // Only a local poll is ours to tally: a vote for a stored remote poll is
    // not something this instance counts. And the voter must be allowed to see
    // the poll at all — a followers-only or direct poll must not accept a vote
    // from someone outside its audience, which is the same rule the read paths
    // enforce. An unknown voter resolves to `null`, so only a publicly readable
    // poll passes for them — except an explicit recipient, who is named in the
    // poll's own `to`/`cc` and so is in its audience whether or not this
    // instance has stored an actors row for them yet.
    if (!pollStatus.isLocalActor) {
      return
    }

    const voter = await database.getActorFromId({ id: note.attributedTo })
    const isExplicitRecipient =
      pollStatus.to.includes(note.attributedTo) ||
      pollStatus.cc.includes(note.attributedTo)
    if (
      !isExplicitRecipient &&
      !(await canActorReadStatus({
        database,
        status: pollStatus,
        currentActor: voter ?? null
      }))
    ) {
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

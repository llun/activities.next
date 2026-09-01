import { getContent, getSummary } from '@/lib/activities/note'
import { getPollChoicesFromQuestion } from '@/lib/services/polls/pollChoices'
import { ENTITY_TYPE_QUESTION, Question } from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import {
  normalizeActivityPubContent,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { UPDATE_POLL_JOB_NAME } from './names'

export const updatePollJob = createJobHandle(
  UPDATE_POLL_JOB_NAME,
  async (database, message) => {
    const parseResult = Question.safeParse(
      normalizeActivityPubContent(message.data)
    )
    if (!parseResult.success) {
      logger.warn({
        message: 'Dropping malformed poll update payload',
        job: UPDATE_POLL_JOB_NAME,
        statusId: (message.data as { id?: unknown } | null)?.id
      })
      return
    }
    const question = parseResult.data
    const existingStatus = await database.getStatus({
      statusId: question.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Poll) {
      return
    }

    // An Update may only be applied by the poll's OWN author — the poll twin of
    // the guard in updateNoteJob, which was missing here. Routing verifies the
    // payload's `attributedTo` against the signer (`getJobMessage`'s
    // `createObjectActorMismatch`), which an attacker satisfies by attributing
    // the payload to themselves while pointing `id` at someone else's status —
    // so without this the target is resolved by `question.id` alone and any
    // federated actor can rewrite the text, spoiler and choice tallies of any
    // stored poll, local users included, complete with a `status_history`
    // revision that makes the defacement read as a genuine edit by the victim.
    if (
      normalizeActorId(question.attributedTo) !==
      normalizeActorId(existingStatus.actorId)
    ) {
      logger.warn({
        message: 'Ignoring an Update for a poll the sender does not own',
        statusId: question.id,
        statusActorId: existingStatus.actorId,
        updateActorId: question.attributedTo
      })
      return
    }

    if (question.type !== ENTITY_TYPE_QUESTION) {
      return
    }

    const text = getContent(question)
    const summary = getSummary(question)
    await database.updatePoll({
      statusId: question.id,
      summary,
      text,
      choices: getPollChoicesFromQuestion(question)
    })
  }
)

import { getContent, getSummary } from '@/lib/activities/note'
import {
  getPollChoicesFromQuestion,
  getPollEndAtFromQuestion,
  parseQuestionTime
} from '@/lib/services/polls/pollChoices'
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
    // `bindObjectToSender`), which an attacker satisfies by attributing
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

    // Mastodon's ActivityPub::ProcessStatusUpdateService: an Update whose
    // `updated` is not newer than the last one applied is stale and ignored
    // (already_updated_more_recently?); one with no `updated` is implicit (a
    // tally refresh) and may not make a significant change — no option change,
    // vote reset, mode switch or deadline move (update_poll! with
    // allow_significant_changes: false) and, as handle_implicit_update! never
    // touches the text or spoiler, refreshes only the tallies, and those only
    // when the options are unchanged.
    const remoteUpdatedAt = parseQuestionTime(question.updated)
    if (
      remoteUpdatedAt !== undefined &&
      existingStatus.remoteUpdatedAt !== undefined &&
      // Strictly older only, as Mastodon's already_updated_more_recently?; an
      // Update with the same `updated` is a tally refresh, handled as implicit
      // below.
      remoteUpdatedAt < existingStatus.remoteUpdatedAt
    ) {
      logger.info({
        message: 'Ignoring a stale poll update',
        statusId: question.id,
        updated: question.updated,
        lastAppliedUpdated: existingStatus.remoteUpdatedAt
      })
      return
    }
    // Explicit only when strictly newer, as ProcessStatusUpdateService picks
    // handle_explicit_update! for `edited_at > @status.edited_at`.
    const implicit =
      remoteUpdatedAt === undefined ||
      remoteUpdatedAt === existingStatus.remoteUpdatedAt

    const text = getContent(question)
    const summary = getSummary(question)
    const pollType = question.oneOf
      ? 'oneOf'
      : question.anyOf
        ? 'anyOf'
        : existingStatus.pollType
    const nextChoices = getPollChoicesFromQuestion(question)
    const storedTitles = existingStatus.choices.map((choice) => choice.title)
    // Mastodon's PollParser#significantly_changes?: the option titles in order
    // or the single/multiple mode differ. An Update carrying no options leaves
    // the option set alone.
    const optionsChanged =
      nextChoices.length > 0 &&
      (pollType !== existingStatus.pollType ||
        nextChoices.length !== storedTitles.length ||
        nextChoices.some(
          (choice, index) => choice.title !== storedTitles[index]
        ))
    // On a reset the stored local votes are cleared so voters can vote again
    // and the new options carry the Update's own tallies (0 when absent).
    // Otherwise an option without `replies` keeps its stored tally.
    const resetVotes = optionsChanged && !implicit
    const endAt = getPollEndAtFromQuestion(question, existingStatus.endAt)
    await database.updatePoll({
      statusId: question.id,
      choices: resetVotes
        ? nextChoices
        : optionsChanged
          ? []
          : getPollChoicesFromQuestion(question, existingStatus.choices),
      ...(implicit
        ? {}
        : {
            text,
            summary,
            pollType,
            remoteUpdatedAt,
            ...(endAt !== undefined ? { endAt } : {})
          }),
      resetVotes
    })
  }
)

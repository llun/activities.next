import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import {
  getContent,
  getLanguage,
  getReply,
  getSummary,
  getUrl
} from '@/lib/activities/note'
import { isPubliclyAddressed } from '@/lib/database/domains/status/status'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { getPollChoicesFromQuestion } from '@/lib/services/polls/pollChoices'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { ENTITY_TYPE_QUESTION, Question } from '@/lib/types/activitypub'
import {
  normalizeActivityPubContent,
  toRecipientArray
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { CREATE_POLL_JOB_NAME } from './names'
import { persistNoteTags } from './noteTags'
import { actorMatchesVerifiedSender } from './verifiedSender'

export const createPollJob = createJobHandle(
  CREATE_POLL_JOB_NAME,
  async (database, message) => {
    const parseResult = Question.safeParse(
      normalizeActivityPubContent(message.data)
    )
    if (!parseResult.success) {
      logger.warn({
        message: 'Dropping malformed poll payload',
        job: CREATE_POLL_JOB_NAME,
        statusId: (message.data as { id?: unknown } | null)?.id
      })
      return
    }
    const question = parseResult.data
    if (!actorMatchesVerifiedSender(question.attributedTo, message)) {
      return
    }

    const existingStatus = await database.getStatus({
      statusId: question.id,
      withReplies: false
    })
    if (existingStatus) {
      return
    }

    if (question.type !== ENTITY_TYPE_QUESTION) {
      return
    }

    const text = getContent(question)
    const summary = getSummary(question)
    // Mirror createNoteJob: resolve the poll's declared language from its
    // content/summary locale maps so polls carry it like notes do, which lets
    // the Translate control appear on polls too.
    const language = getLanguage(question)
    const pollType = question.oneOf
      ? 'oneOf'
      : question.anyOf
        ? 'anyOf'
        : 'oneOf'
    const choices = getPollChoicesFromQuestion(question)

    await assertActorCanFederate({
      actorId: question.attributedTo,
      database
    })

    const [, createResult] = await Promise.all([
      recordActorIfNeeded({
        actorId: question.attributedTo,
        database
      }),
      database.createPollWithResult({
        id: question.id,
        // A peer's `url` is served back to clients as a link, so only an
        // http(s) value is kept — the same rule createNoteJob applies.
        url: getUrl(question.url) || question.id,

        actorId: question.attributedTo,

        text,
        summary,

        to: toRecipientArray(question.to),
        cc: toRecipientArray(question.cc),

        reply: getReply(question.inReplyTo) || '',
        choices,
        pollType,
        language,
        endAt: question.endTime
          ? new Date(question.endTime).getTime()
          : new Date(question.published).getTime() +
            100 * 365 * 24 * 60 * 60 * 1000,
        createdAt: new Date(question.published).getTime()
      })
    ])
    const { status, isNew } = createResult

    // A concurrent delivery of the same poll won the unique-key insert, so this
    // call recovered the winner's row rather than creating one. The winner's own
    // run owns every side effect below — timelines, tags, hashtag counters — so
    // re-running them here would double-count. This is the concurrent-race twin
    // of the `if (existingStatus) return` guard above, which drops a sequential
    // duplicate the same way.
    if (!isNew) {
      return
    }

    // Content-detected language, stored separately from the declared
    // `language` above so the Translate gate can fall back to it when a
    // remote poll's declared/default language doesn't match its actual
    // content.
    await persistDetectedLanguage({
      database,
      statusId: status.id,
      text,
      html: true,
      declaredLanguage: language
    })

    const [, affectedHashtags] = await Promise.all([
      addStatusToTimelines(database, status),
      persistNoteTags({
        database,
        statusId: question.id,
        note: question
      })
    ])
    // The count is served to anonymous /tags/<tag> visitors; a followers-only
    // or direct poll must not move it.
    if (
      isPubliclyAddressed({
        to: toRecipientArray(question.to),
        cc: toRecipientArray(question.cc)
      })
    ) {
      for (const hashtag of affectedHashtags) {
        await database.increaseHashtagCounter({ hashtag: hashtag.slice(1) })
      }
    }
    if (affectedHashtags.length > 0) {
      await database.indexHashtagSearchDocuments({
        hashtags: affectedHashtags
      })
    }
  }
)

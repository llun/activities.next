import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import {
  getContent,
  getLanguage,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
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
        url: typeof question.url === 'string' ? question.url : question.id,

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
      html: true
    })

    const tags = getTags(question)
    const seenHashtags = new Set<string>()
    const affectedHashtags: string[] = []
    await Promise.all([
      addStatusToTimelines(database, status),
      ...tags.map(async (item) => {
        if (item.type === 'Emoji') {
          return database.createTag({
            statusId: question.id,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        if (item.type === 'Hashtag') {
          const hashtagName = (item.name || '').trim()
          const hashtagHref = (item.href || '').trim()
          if (!hashtagName || !hashtagHref) return
          const normalizedKey = hashtagName.toLowerCase()
          if (seenHashtags.has(normalizedKey)) return
          seenHashtags.add(normalizedKey)
          affectedHashtags.push(hashtagName)

          await database.createTag({
            statusId: question.id,
            name: hashtagName,
            value: hashtagHref,
            type: 'hashtag',
            skipSearchIndex: true
          })
          const tagName = hashtagName.startsWith('#')
            ? hashtagName.slice(1)
            : hashtagName
          await database.increaseHashtagCounter({ hashtag: tagName })
          return
        }
        return database.createTag({
          statusId: question.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    ])
    if (affectedHashtags.length > 0) {
      await database.indexHashtagSearchDocuments({
        hashtags: affectedHashtags
      })
    }
  }
)

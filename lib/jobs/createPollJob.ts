import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import {
  getContent,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { ENTITY_TYPE_QUESTION, Question } from '@/lib/types/activitypub'
import {
  normalizeActivityPubContent,
  toRecipientArray
} from '@/lib/utils/activitypub'

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
    const pollType = question.oneOf
      ? 'oneOf'
      : question.anyOf
        ? 'anyOf'
        : 'oneOf'
    const choices =
      question.oneOf?.map((item) => item.name) ??
      question.anyOf?.map((item) => item.name) ??
      []

    await assertActorCanFederate({
      actorId: question.attributedTo,
      database
    })

    const [, status] = await Promise.all([
      recordActorIfNeeded({
        actorId: question.attributedTo,
        database
      }),
      database.createPoll({
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
        endAt: question.endTime
          ? new Date(question.endTime).getTime()
          : new Date(question.published).getTime() +
            100 * 365 * 24 * 60 * 60 * 1000,
        createdAt: new Date(question.published).getTime()
      })
    ])

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

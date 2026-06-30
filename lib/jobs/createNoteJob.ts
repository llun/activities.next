import { z } from 'zod'

import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import {
  BaseNote,
  getAttachments,
  getContent,
  getLanguage,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import { detectLanguageFromHtml } from '@/lib/services/language-detection'
import { addStatusToTimelines } from '@/lib/services/timelines'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import {
  normalizeActivityPubContent,
  normalizeActorId,
  toRecipientArray
} from '@/lib/utils/activitypub'

import { createJobHandle } from './createJobHandle'
import { CREATE_NOTE_JOB_NAME } from './names'
import { actorMatchesVerifiedSender } from './verifiedSender'

export const createNoteJob = createJobHandle(
  CREATE_NOTE_JOB_NAME,
  async (database, message) => {
    // Intentionally excludes Question: poll creation is routed to
    // createPollJob by getJobMessage, so a Question payload never reaches here.
    // The parsed note-like subset is a subset of BaseNote, so the cast widens.
    const BaseNoteSchema = z.union([
      Note,
      ImageContent,
      PageContent,
      ArticleContent,
      VideoContent
    ])
    const note = BaseNoteSchema.parse(
      normalizeActivityPubContent(message.data)
    ) as BaseNote
    if (!actorMatchesVerifiedSender(note.attributedTo, message)) {
      return
    }

    const attachments = getAttachments(note)

    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (existingStatus) {
      return
    }

    if (
      note.type !== StatusType.enum.Note &&
      note.type !== 'Image' &&
      note.type !== 'Page' &&
      note.type !== 'Article' &&
      note.type !== 'Video'
    ) {
      return
    }

    const text = getContent(note)
    const summary = getSummary(note)
    const language = getLanguage(note)
    const actorId = normalizeActorId(note.attributedTo) ?? note.attributedTo

    const publishedAt = new Date(note.published).getTime()

    await assertActorCanFederate({
      actorId,
      database
    })

    const [, status] = await Promise.all([
      recordActorIfNeeded({ actorId, database }),
      database.createNote({
        id: note.id,
        url: typeof note.url === 'string' ? note.url : note.id,

        actorId,

        text,
        summary,
        language,

        to: toRecipientArray(note.to),
        cc: toRecipientArray(note.cc),

        reply: getReply(note.inReplyTo) || '',
        createdAt: publishedAt
      })
    ])

    // Content-detected language, stored separately from the declared
    // `language` above so the Translate gate can fall back to it when a
    // remote note's declared/default language doesn't match its actual
    // content (e.g. mislabeled or untagged posts).
    const detected = detectLanguageFromHtml(text)
    if (detected) {
      await database.setDetectedLanguage({
        statusId: status.id,
        language: detected.language,
        confidence: detected.confidence
      })
    }

    const tags = getTags(note)

    // Tags must be persisted before timeline rules run so that
    // notifyRemoteReplyAndMention can verify mentions via tags rather than text
    // content.
    const seenHashtags = new Set<string>()
    const affectedHashtags: string[] = []
    await Promise.all(
      tags.map(async (item) => {
        if (item.type === 'Emoji') {
          return database.createTag({
            statusId: note.id,
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
            statusId: note.id,
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
          statusId: note.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    )
    if (affectedHashtags.length > 0) {
      await database.indexHashtagSearchDocuments({
        hashtags: affectedHashtags
      })
    }

    await Promise.all([
      addStatusToTimelines(database, status),
      ...attachments.map(async (attachment, index) => {
        if (attachment.type !== 'Document') return
        return database.createAttachment({
          actorId,
          statusId: note.id,
          mediaType: attachment.mediaType,
          height: attachment.height,
          width: attachment.width,
          name: attachment.name || '',
          url: attachment.url,
          createdAt: publishedAt + index
        })
      })
    ])
  }
)

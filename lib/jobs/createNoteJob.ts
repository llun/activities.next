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
  getQuoteTargetId,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import { normalizeBlurhash } from '@/lib/services/medias/imageAnalysis'
import {
  persistInboundQuoteEdge,
  resolveInboundQuotedStatus
} from '@/lib/services/quotes/persistInboundQuoteEdge'
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
import { isValidFocalPoint } from '@/lib/utils/focalPoint'

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
    await persistDetectedLanguage({
      database,
      statusId: status.id,
      text,
      html: true
    })

    // Record the quote edge (FEP-044f) if this note quotes another status. The
    // state is derived from the receiver rules; a fetch/verification failure
    // degrades to `pending` and never drops the note.
    const quotedStatusId = getQuoteTargetId(note)
    if (quotedStatusId) {
      // A Mastodon 4.5 quote references a post we usually do not already store,
      // so the shared resolver fetches it (instance-signed, mirroring the boost
      // path in createAnnounceJob) when the note carries a stamp worth
      // verifying. `skipQuoteResolution` bounds that to a single hop so a chain
      // of quoting notes cannot drive unbounded recursive fetches.
      const quotedStatus = message.skipQuoteResolution
        ? await database.getStatus({
            statusId: quotedStatusId,
            withReplies: false
          })
        : await resolveInboundQuotedStatus({
            database,
            note,
            quotedStatusId,
            storeNote: (fetchedQuotedNote, bound) =>
              createNoteJob(database, {
                id: fetchedQuotedNote.id,
                name: CREATE_NOTE_JOB_NAME,
                data: fetchedQuotedNote,
                ...bound
              })
          })
      // Derive and write the edge. An edge may already exist here (e.g. we
      // accepted this actor's QuoteRequest before the Create Note arrived); the
      // shared helper advances it through the one-way state machine so a
      // re-derived `pending` never downgrades an accepted edge.
      await persistInboundQuoteEdge({
        database,
        note,
        actorId,
        quotedStatus,
        quotedStatusId
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
        // Store what the normalizer returns, not the value it was handed:
        // it validates the trimmed form, so a padded hash approved here and
        // persisted verbatim would fail `decode` on every render.
        const blurhash = normalizeBlurhash(attachment.blurhash)
        const focus =
          attachment.focalPoint &&
          isValidFocalPoint(attachment.focalPoint[0], attachment.focalPoint[1])
            ? { x: attachment.focalPoint[0], y: attachment.focalPoint[1] }
            : null

        return database.createAttachment({
          actorId,
          statusId: note.id,
          mediaType: attachment.mediaType,
          height: attachment.height,
          width: attachment.width,
          name: attachment.name || '',
          url: attachment.url,
          blurhash,
          focus,
          createdAt: publishedAt + index
        })
      })
    ])

    // A remote status gets a card too — most of a timeline is remote, so
    // without this the feature barely exists. The fetch is delayed by a random
    // interval under a real queue so this instance is not part of a thundering
    // herd on a widely-shared link.
    //
    // Scheduled last, after the status is on timelines, for the same reason the
    // local create and edit paths schedule after their publish: on the default
    // in-process queue this runs the third-party fetch inline, and an inbound
    // post should not wait on someone else's server to become visible here.
    await syncStatusLinkPreview({ database, status })
  }
)

import { z } from 'zod'

import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { getNote } from '@/lib/activities'
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
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { verifyRemoteQuote } from '@/lib/services/quotes/verifyRemoteQuote'
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
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { CREATE_NOTE_JOB_NAME } from './names'
import { actorMatchesVerifiedSender } from './verifiedSender'

// Two ids share authority when served from the same host.
const sameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

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
      let quotedStatus = await database.getStatus({
        statusId: quotedStatusId,
        withReplies: false
      })
      // A Mastodon 4.5 quote references a post we usually do not already store.
      // When the note carries a FEP-044f authorization stamp, fetch the quoted
      // note (instance-signed, mirroring the boost path in createAnnounceJob) and
      // store it so verifyRemoteQuote can confirm the quoted author and the quote
      // card can load the content. Without this, every remote quote is stuck as a
      // `pending` tombstone even when it was legitimately approved. Fetching only
      // makes the author knowable — the stamp is still validated below, so a
      // fetch never grants trust on its own.
      //
      // `skipQuoteResolution` bounds this to a single hop: the quoted note is
      // stored WITHOUT chasing its own quote target, so an attacker-controlled
      // chain of quoting notes (A quotes B quotes C …) cannot drive unbounded
      // recursive fetches. Wrapped in try/catch so any failure (e.g. the quoted
      // author's domain is federation-blocked, or a store error) leaves
      // `quotedStatus` null and degrades the edge to `pending` rather than
      // throwing and orphaning this note (the "never drops the note" invariant).
      if (
        !quotedStatus &&
        note.quoteAuthorization &&
        !message.skipQuoteResolution
      ) {
        try {
          const signingActor = await getFederationSigningActor(database)
          const fetchedQuotedNote = await getNote({
            statusId: quotedStatusId,
            signingActor
          })
          if (fetchedQuotedNote) {
            await createNoteJob(database, {
              id: fetchedQuotedNote.id,
              name: CREATE_NOTE_JOB_NAME,
              data: fetchedQuotedNote,
              skipQuoteResolution: true
            })
            quotedStatus = await database.getStatus({
              statusId: quotedStatusId,
              withReplies: false
            })
          }
        } catch (error) {
          logger.warn({
            message:
              'Failed to fetch quoted note for inbound quote; leaving the edge pending',
            quotedStatusId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      const state = await verifyRemoteQuote({
        database,
        note,
        actorId,
        quotedStatus
      })
      // Only trust an inbound stamp uri when the quote actually verified as
      // accepted AND the stamp is served from the quoted status's own authority.
      // A remote note can claim any `quoteAuthorization`; persisting it on a
      // pending/rejected or cross-authority edge would let a forged note shadow a
      // legitimate stamp (the authorizationUri index is non-unique).
      const authorizationUri =
        state === 'accepted' &&
        note.quoteAuthorization &&
        sameHost(note.quoteAuthorization, quotedStatusId)
          ? note.quoteAuthorization
          : undefined
      const existingEdge = await database.getStatusQuote({ statusId: note.id })
      if (existingEdge) {
        // The edge already exists (e.g. we accepted this actor's QuoteRequest
        // before the Create Note arrived). Advance it via the one-way state
        // machine so a re-derived `pending` never downgrades an accepted edge.
        await database.updateStatusQuoteState({
          statusId: note.id,
          state,
          authorizationUri
        })
      } else {
        await database.createStatusQuote({
          statusId: note.id,
          quotedStatusId,
          state,
          authorizationUri: authorizationUri ?? null
        })
      }
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

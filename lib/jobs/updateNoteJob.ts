import { z } from 'zod'

import {
  BaseNote,
  getContent,
  getLanguage,
  getSummary
} from '@/lib/activities/note'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import { notifyQuotedStatusUpdate } from '@/lib/services/notifications/notifyQuotedStatusUpdate'
import { syncQuoteEdgeFromUpdate } from '@/lib/services/quotes/persistInboundQuoteEdge'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'

import { createJobHandle } from './createJobHandle'
import { UPDATE_NOTE_JOB_NAME } from './names'

export const updateNoteJob = createJobHandle(
  UPDATE_NOTE_JOB_NAME,
  async (database, message) => {
    // Intentionally excludes Question: poll updates are routed to updatePollJob
    // by getJobMessage, so a Question payload never reaches here. The parsed
    // note-like subset is a subset of BaseNote, so the cast widens.
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
    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Note) {
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
    // Refresh the language from the edited note, but preserve the existing
    // value when the update carries no locale (updateNote treats `undefined`
    // as "keep").
    const language = getLanguage(note) ?? undefined

    // Only a change to the readable content (text/summary) notifies quoters. A
    // metadata-only Update — interaction/quote policy, visibility, or a
    // re-federated quote-approval stamp — carries unchanged content, and
    // updateNote records a history revision unconditionally, so compare before
    // updating to avoid false "edited a post you quoted" notifications.
    const contentChanged =
      text !== existingStatus.text ||
      (summary || '') !== (existingStatus.summary || '')

    await database.updateNote({
      statusId: note.id,
      summary,
      text,
      language
    })

    // A quoter re-federates its note as an Update once the quoted author's
    // Accept hands it a `quoteAuthorization` stamp, so an Update is the second
    // place an approval can arrive. Without re-deriving the edge here a quote
    // approved after its Create stays a "pending approval" tombstone forever,
    // even though every other server shows it as accepted. Runs regardless of
    // `contentChanged` — a stamp-only re-federation carries unchanged content,
    // which is exactly the case this exists for.
    // The quoting actor is this note's STORED author, never the `attributedTo`
    // the Update payload carries: verifyRemoteQuote's self-quote shortcut
    // accepts outright when quoter == quoted author, so trusting a payload
    // field there would let an edit claim authorship it does not have.
    await syncQuoteEdgeFromUpdate({
      database,
      note,
      actorId: existingStatus.actorId
    })

    // Re-detect the content language alongside the edit; the previous
    // detection (if any) is stale once the text changes — persistDetectedLanguage
    // clears the old row when the new content no longer detects confidently.
    await persistDetectedLanguage({
      database,
      statusId: note.id,
      text,
      html: true
    })

    // Re-run the preview card only for a real content edit, for the same reason
    // the quoter notification below is gated on it: a metadata-only Update
    // carries the same text and cannot have moved the link.
    if (contentChanged) {
      const updatedStatus = await database.getStatus({ statusId: note.id })
      if (updatedStatus) {
        await syncStatusLinkPreview({ database, status: updatedStatus })
      }
    }

    // A remote status our users may have quoted was edited elsewhere; notify the
    // local authors of accepted quotes of it, but only for a real content edit
    // (a metadata-only Update must not spam quoters). The edit's author is the
    // source.
    if (contentChanged) {
      await notifyQuotedStatusUpdate({
        database,
        quotedStatusId: note.id,
        sourceActorId: existingStatus.actorId
      })
    }
  }
)

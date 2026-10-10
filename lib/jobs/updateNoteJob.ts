import { z } from 'zod'

import {
  BaseNote,
  getContent,
  getLanguage,
  getSummary
} from '@/lib/activities/note'
import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { Database } from '@/lib/database/types'
import {
  getForwardActivityJobMessages,
  getForwardingTargetLocalActorIds,
  resolveForwardingInboxes,
  shouldForwardActivity
} from '@/lib/services/federation/forwardingDelivery'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import { notifyQuotedStatusUpdate } from '@/lib/services/notifications/notifyQuotedStatusUpdate'
import { getQueue } from '@/lib/services/queue'
import { syncQuoteEdgeFromUpdate } from '@/lib/services/quotes/persistInboundQuoteEdge'
import {
  ArticleContent,
  AudioContent,
  ENTITY_TYPE_QUESTION,
  EventContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'
import { UpdateAction } from '@/lib/types/activitypub/activities'
import { isFitnessAttachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import {
  normalizeActivityPubContent,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { createNoteJob } from './createNoteJob'
import { createPollJob } from './createPollJob'
import {
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  UPDATE_NOTE_JOB_NAME
} from './names'
import {
  buildRemoteAttachments,
  getRemoteAttachmentDocuments
} from './noteAttachments'

/**
 * Replaces the stored attachments of a remote note when the Update carries a
 * different list (an edited photo, one added or removed), compared by URL and
 * order. Mastodon replaces media on Update the same way. Only the rows the
 * note brought along are replaced: an attachment of a local media row and a
 * fitness file are never touched, and a local status is left alone.
 */
const syncRemoteAttachments = async ({
  database,
  note,
  status
}: {
  database: Database
  note: BaseNote
  status: Status
}) => {
  if (status.isLocalActor || status.type !== StatusType.enum.Note) return

  const incoming = getRemoteAttachmentDocuments(note, {
    withoutFitness: true
  }).map((attachment) => attachment.url)
  const stored = status.attachments
    .filter(
      (attachment) =>
        attachment.mediaId == null && !isFitnessAttachment(attachment)
    )
    .map((attachment) => attachment.url)
  if (
    incoming.length === stored.length &&
    incoming.every((url, index) => url === stored[index])
  ) {
    return
  }

  // Built first (a video's playback type may need a fetch), then swapped in
  // one transaction: a failure leaves the stored rows as they were, and no
  // reader sees the post without its media in between.
  const attachments = await buildRemoteAttachments({
    statusId: status.id,
    note,
    withoutFitness: true
  })
  await database.replaceRemoteAttachmentsForStatus({
    statusId: status.id,
    attachments
  })
}

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
      VideoContent,
      AudioContent,
      EventContent
    ])
    const parseResult = BaseNoteSchema.safeParse(
      normalizeActivityPubContent(message.data)
    )
    if (!parseResult.success) {
      logger.warn({
        message: 'Dropping malformed note update payload',
        job: UPDATE_NOTE_JOB_NAME,
        statusId: (message.data as { id?: unknown } | null)?.id
      })
      return
    }
    const note = parseResult.data as BaseNote
    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Note) {
      return
    }

    // An Update may only be applied by the note's OWN author. Routing verifies
    // the payload's `attributedTo` against the signer (`getJobMessage`'s
    // `bindObjectToSender`), which an attacker satisfies by attributing
    // the payload to themselves while pointing `id` at someone else's status —
    // so without this the target is resolved by `note.id` alone and any
    // federated actor can rewrite the text of any stored status, local users
    // included, complete with a `status_history` revision that makes the
    // defacement read as a genuine edit by the victim.
    if (
      normalizeActorId(note.attributedTo) !==
      normalizeActorId(existingStatus.actorId)
    ) {
      logger.warn({
        message: 'Ignoring an Update for a status the sender does not own',
        statusId: note.id,
        statusActorId: existingStatus.actorId,
        updateActorId: note.attributedTo
      })
      return
    }

    if (
      note.type !== StatusType.enum.Note &&
      note.type !== 'Image' &&
      note.type !== 'Page' &&
      note.type !== 'Article' &&
      note.type !== 'Video' &&
      note.type !== 'Audio' &&
      note.type !== 'Event'
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
      // An edit that carries no flag keeps the stored one; an explicit `false`
      // is the author un-marking their media.
      sensitive:
        typeof note.sensitive === 'boolean' ? note.sensitive : undefined,
      language
    })

    await syncRemoteAttachments({ database, note, status: existingStatus })

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
      actorId: existingStatus.actorId,
      storeNote: (fetchedQuotedNote, bound) => {
        if (fetchedQuotedNote.type === ENTITY_TYPE_QUESTION) {
          return createPollJob(database, {
            id: fetchedQuotedNote.id,
            name: CREATE_POLL_JOB_NAME,
            data: fetchedQuotedNote,
            ...bound
          })
        }
        return createNoteJob(database, {
          id: fetchedQuotedNote.id,
          name: CREATE_NOTE_JOB_NAME,
          data: fetchedQuotedNote,
          ...bound
        })
      }
    })

    // Re-detect the content language alongside the edit; the previous
    // detection (if any) is stale once the text changes — persistDetectedLanguage
    // clears the old row when the new content no longer detects confidently.
    await persistDetectedLanguage({
      database,
      statusId: note.id,
      text,
      html: true,
      declaredLanguage: language
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

    // Outbound Inbox Forwarding (W3C ActivityPub §7.1.2):
    // Fan out verified public replies and mentions of local users to their followers.
    if (
      shouldForwardActivity({
        message,
        authorActorId: note.attributedTo,
        activityId: note.id,
        to: note.to,
        cc: note.cc
      })
    ) {
      const targetLocalActorIds = await getForwardingTargetLocalActorIds({
        database,
        inReplyTo: note.inReplyTo,
        tags: note.tag,
        to: note.to,
        cc: note.cc
      })

      if (targetLocalActorIds.length > 0) {
        const inboxes = await resolveForwardingInboxes({
          database,
          targetLocalActorIds,
          authorActorId: note.attributedTo,
          to: note.to,
          cc: note.cc
        })

        if (inboxes.length > 0) {
          const updateActivity = {
            '@context': NOTE_ACTIVITY_CONTEXT,
            id: `${note.id}#activity`,
            type: UpdateAction,
            actor: note.attributedTo,
            published: note.published,
            to: note.to,
            cc: note.cc,
            object: note
          }

          for (const forwardMessage of getForwardActivityJobMessages({
            id: `${getHashFromString(note.id)}#forward-update`,
            activity: updateActivity,
            inboxes,
            localActorId: targetLocalActorIds[0]
          })) {
            await getQueue().publish(forwardMessage)
          }
        }
      }
    }
  }
)

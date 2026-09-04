import { persistEmojiTagsForStatus } from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import { withAttachmentMediaMetadata } from '@/lib/services/medias/attachmentMediaMetadata'
import { notifyQuotedStatusUpdate } from '@/lib/services/notifications/notifyQuotedStatusUpdate'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { withSpan } from '@/lib/utils/trace'

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text?: string
  summary?: string | null
  attachments?: PostBoxAttachment[]
  sensitive?: boolean
  language?: string | null
  publish?: boolean
  status?: StatusNote
  database: Database
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  attachments,
  sensitive,
  language,
  publish = true,
  status: preloadedStatus,
  database
}: UpdateNoteFromUserInput) =>
  withSpan('actions', 'updateNoteFromUser', { statusId }, async () => {
    const status = preloadedStatus ?? (await database.getStatus({ statusId }))
    if (
      !status ||
      status.id !== statusId ||
      status.type !== StatusType.enum.Note ||
      status.actorId !== currentActor.id
    ) {
      return null
    }

    // Re-read the placeholder and focal point from the owner's own media rows
    // rather than carrying whatever the request body held: the attachment row
    // snapshots them, `POST /api/v1/accounts/outbox` accepts client-supplied
    // attachment objects, and a `media_attributes` focus edit lands on the
    // media row moments before this — so the media row is both the trusted and
    // the freshest source. Resolved for every attachment, kept and new alike,
    // because `updateNote` rewrites both.
    const resolvedAttachments =
      attachments === undefined
        ? undefined
        : await withAttachmentMediaMetadata({
            database,
            currentActor,
            attachments
          })

    let updatedStatus = await database.updateNote({
      statusId,
      summary: summary === undefined ? status.summary : summary?.trim() || null,
      text: text ?? status.text,
      ...(resolvedAttachments !== undefined
        ? { attachments: resolvedAttachments }
        : {}),
      ...(sensitive !== undefined ? { sensitive } : {}),
      ...(language !== undefined ? { language } : {})
    })
    if (!updatedStatus) {
      return null
    }

    // Re-sync emoji tags when the text, summary, or attachments change so newly
    // added `:shortcode:` tokens federate and removed ones stop federating, then
    // re-fetch so the returned status and the timeline cache reflect the
    // re-synced tags (mirroring createNoteFromUserInput).
    if (
      text !== undefined ||
      summary !== undefined ||
      attachments !== undefined
    ) {
      await database.deleteStatusTagsByType({ statusId, type: 'emoji' })
      const noteAttachments =
        updatedStatus.type === StatusType.enum.Note
          ? updatedStatus.attachments
          : []
      const noteSummary =
        updatedStatus.type === StatusType.enum.Note
          ? (updatedStatus.summary ?? '')
          : ''
      const noteText =
        updatedStatus.type === StatusType.enum.Note ? updatedStatus.text : ''
      await persistEmojiTagsForStatus({
        database,
        statusId,
        text: [
          noteText,
          noteSummary,
          ...noteAttachments.map((a) => a.name || '')
        ]
      })

      if (text !== undefined) {
        // Re-detect the content language alongside the edit; the previous
        // detection (if any) is stale once the text changes — persistDetectedLanguage
        // clears the old row when the new text no longer detects confidently.
        await persistDetectedLanguage({ database, statusId, text })
      }

      updatedStatus = (await database.getStatus({ statusId })) ?? updatedStatus
    }

    await addStatusToTimelines(database, updatedStatus)

    if (publish) {
      await getQueue().publish({
        id: getHashFromString(`${statusId}#update/${updatedStatus.updatedAt}`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: currentActor.id,
          statusId
        }
      })

      // Notify the authors of accepted quotes of this status that a post they
      // quoted was edited. Only published (federated) edits notify quoters.
      await notifyQuotedStatusUpdate({
        database,
        quotedStatusId: statusId,
        sourceActorId: currentActor.id,
        sourceActor: currentActor
      })
    }

    // The edit may have added, changed or removed the link the card was for.
    // Only when the text actually changed: an attachment-only or visibility-only
    // edit cannot move the card.
    //
    // Scheduled AFTER the edit has federated, for the same reason
    // createNoteFromUserInput schedules after its send job: on the default
    // in-process queue `publish` runs the handler inline, so doing this first made
    // an edit to a post containing a link wait on a third-party fetch before the
    // edit reached timelines or went out to other servers.
    if (text !== undefined) {
      await syncStatusLinkPreview({ database, status: updatedStatus })
    }

    return updatedStatus
  })

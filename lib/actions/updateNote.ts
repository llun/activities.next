import {
  notifyNewLocalMentions,
  persistEmojiTagsForStatus,
  resolveStatusMentions,
  runBestEffortStep,
  settleAll
} from '@/lib/actions/createNote'
import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import { isPubliclyAddressed } from '@/lib/database/domains/status/status'
import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import { withAttachmentMediaMetadata } from '@/lib/services/medias/attachmentMediaMetadata'
import { notifyQuotedStatusUpdate } from '@/lib/services/notifications/notifyQuotedStatusUpdate'
import { getQueue } from '@/lib/services/queue'
import { syncHashtagCounters } from '@/lib/services/statuses/hashtagCounters'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getVisibility } from '@/lib/utils/getVisibility'
import {
  MENTION_GLOBAL_REGEX,
  MentionMatchGroup
} from '@/lib/utils/text/convertMarkdownText'
import { getHashtags } from '@/lib/utils/text/getHashtags'
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

// The mention tokens the text names, lowercased, so a stored tag's `name`
// (`@user@domain`) can be matched as a whole token rather than as a prefix of a
// longer handle. The domain pattern swallows a sentence's trailing period, so
// it is trimmed.
const mentionNamesInText = (text: string): Set<string> =>
  new Set(
    Array.from(text.matchAll(MENTION_GLOBAL_REGEX)).map((match) => {
      const { username, domain } = match.groups as MentionMatchGroup
      const host = domain?.replace(/\.+$/, '')
      return `@${username}${host ? `@${host}` : ''}`.toLowerCase()
    })
  )

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
    // because `updateNote` rewrites both. The one exception is an attachment
    // still showing an earlier file of an edited photo ("Gallery only"): it
    // keeps the snapshot its row took of that file.
    const resolvedAttachments =
      attachments === undefined
        ? undefined
        : await withAttachmentMediaMetadata({
            database,
            currentActor,
            attachments,
            existingAttachments: status.attachments
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

    const previousHashtagCounts = new Map<string, number>()
    let newlyMentioned: Mention[] = []

    // Re-sync tags when the text, summary, or attachments change so newly added
    // emoji, mentions and hashtags federate and removed ones stop federating,
    // then re-fetch so the returned status and the timeline cache reflect the
    // re-synced tags and recipients (mirroring createNoteFromUserInput).
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

      if (text !== undefined && updatedStatus.type === StatusType.enum.Note) {
        for (const tag of updatedStatus.tags) {
          if (tag.type !== 'hashtag') continue
          const name = normalizeHashtagSearchName(tag.name)
          if (name) {
            previousHashtagCounts.set(
              name,
              (previousHashtagCounts.get(name) ?? 0) + 1
            )
          }
        }
        const previousMentionTags = updatedStatus.tags.filter(
          (tag) => tag.type === 'mention'
        )
        const previousMentionActorIds = new Set(
          previousMentionTags.map((tag) => tag.value)
        )

        const replyStatus = updatedStatus.reply
          ? await database.getStatus({
              statusId: updatedStatus.reply,
              withReplies: false
            })
          : null
        const currentVisibility = getVisibility(
          updatedStatus.to,
          updatedStatus.cc,
          currentActor.followersUrl
        )
        const {
          effectiveVisibility,
          recipientMentions,
          mentionTags,
          notificationMentions
        } = await resolveStatusMentions({
          text,
          currentActor,
          replyStatus,
          visibility: currentVisibility
        })
        const hashtags = getHashtags(text, currentActor.domain)

        // A webfinger failure on an edit must not drop a mention the post still
        // names: keep the stored tag for an account the new text still names,
        // even though it did not resolve this time. It is not newly mentioned,
        // so it neither notifies nor changes recipients.
        const resolvedMentionActorIds = new Set(
          mentionTags.map((mention) => mention.href)
        )
        const namedMentionNames = mentionNamesInText(text)
        const keptMentionTags = previousMentionTags.filter(
          (tag) =>
            !resolvedMentionActorIds.has(tag.value) &&
            namedMentionNames.has(tag.name.toLowerCase())
        )

        await Promise.all([
          database.deleteStatusTagsByType({ statusId, type: 'mention' }),
          database.deleteStatusTagsByType({ statusId, type: 'hashtag' })
        ])

        // Add newly mentioned actors to the status's recipients the way create
        // would address them (direct → to; otherwise cc) without removing
        // existing recipients (removed mentions stay silent; access is not
        // revoked by an edit). Self-mentions are never addressed. Run before
        // inserting the new hashtag tags so updateNoteVisibility does not run
        // an unguarded hashtag-search reindex ahead of the best-effort step.
        const existingRecipients = new Set([
          ...updatedStatus.to,
          ...updatedStatus.cc
        ])
        const newRecipientActorIds = [
          ...new Set(
            recipientMentions
              .map((mention) => mention.href)
              .filter(
                (href) =>
                  href !== currentActor.id && !existingRecipients.has(href)
              )
          )
        ]
        if (newRecipientActorIds.length > 0) {
          const nextTo =
            effectiveVisibility === 'direct'
              ? [...updatedStatus.to, ...newRecipientActorIds]
              : updatedStatus.to
          const nextCc =
            effectiveVisibility === 'direct'
              ? updatedStatus.cc
              : [...updatedStatus.cc, ...newRecipientActorIds]
          updatedStatus =
            (await database.updateNoteVisibility({
              statusId,
              to: nextTo,
              cc: nextCc
            })) ?? updatedStatus
        }

        // Only notify actors the status actually addresses: in a direct thread
        // `notificationMentions` also carries inherited thread recipients,
        // which are not added to `to`/`cc` from `recipientMentions`.
        const addressedActorIds = new Set([
          ...updatedStatus.to,
          ...updatedStatus.cc
        ])
        newlyMentioned = notificationMentions.filter(
          (mention) =>
            !previousMentionActorIds.has(mention.href) &&
            addressedActorIds.has(mention.href)
        )

        // Best-effort: a failed tag insert must not leave the edit half applied
        // (text saved, old tags deleted, timelines not re-added). The edit
        // continues to the timeline fan-out and SEND_UPDATE_NOTE.
        await runBestEffortStep(
          statusId,
          'tags',
          () =>
            settleAll([
              ...mentionTags.map((mention) =>
                database.createTag({
                  statusId,
                  name: mention.name || '',
                  value: mention.href,
                  type: 'mention'
                })
              ),
              ...keptMentionTags.map((tag) =>
                database.createTag({
                  statusId,
                  name: tag.name,
                  value: tag.value,
                  type: 'mention'
                })
              ),
              ...hashtags.map((hashtag) =>
                database.createTag({
                  statusId,
                  name: hashtag.name,
                  value: hashtag.value,
                  type: 'hashtag',
                  skipSearchIndex: true
                })
              )
            ]),
          'Status update'
        )

        // Re-detect the content language alongside the edit; the previous
        // detection (if any) is stale once the text changes — persistDetectedLanguage
        // clears the old row when the new text no longer detects confidently.
        // Only the edit's own language is the hint: the stored one may have
        // been defaulted at create and must not suppress detection.
        await persistDetectedLanguage({
          database,
          statusId,
          text,
          declaredLanguage: language ?? null
        })
      }

      updatedStatus = (await database.getStatus({ statusId })) ?? updatedStatus
    }

    if (text !== undefined) {
      // The counters follow what is actually stored, not what the text asked
      // for: a failed hashtag insert must not move a counter for a tag that is
      // not there.
      const currentHashtagNames =
        updatedStatus.type === StatusType.enum.Note
          ? [
              ...new Set(
                updatedStatus.tags
                  .filter((tag) => tag.type === 'hashtag')
                  .map((tag) => normalizeHashtagSearchName(tag.name))
                  .filter(Boolean)
              )
            ]
          : []
      await runBestEffortStep(
        statusId,
        'hashtag counters and search',
        () =>
          syncHashtagCounters({
            database,
            previousCounts: previousHashtagCounts,
            currentNames: currentHashtagNames,
            publiclyAddressed: isPubliclyAddressed({
              to: updatedStatus.to,
              cc: updatedStatus.cc
            })
          }),
        'Status update'
      )
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

    if (
      text !== undefined &&
      newlyMentioned.length > 0 &&
      updatedStatus.type === StatusType.enum.Note
    ) {
      const noteStatus = updatedStatus
      await runBestEffortStep(
        statusId,
        'notifications',
        () =>
          notifyNewLocalMentions({
            database,
            currentActor,
            status: noteStatus,
            mentions: newlyMentioned
          }),
        'Status update'
      )
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

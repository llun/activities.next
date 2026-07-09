import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { StatusEditRevision } from '@/lib/types/database/operations'
import { getMastodonAttachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { processStatusText } from '@/lib/utils/text/processStatusText'

import { getMastodonStatus } from './getMastodonStatus'

/**
 * A Mastodon `StatusEdit` entity (see
 * app/serializers/rest/status_edit_serializer.rb). The `poll` field is the
 * reduced edit shape — just the option titles — not the full `Poll` entity.
 */
export interface MastodonStatusEdit {
  content: string
  spoiler_text: string
  sensitive: boolean
  created_at: string
  account: Mastodon.Account
  // Mastodon omits `poll` entirely for non-poll edits (the serializer only emits
  // it when poll options are present), so the field is optional here.
  poll?: { options: { title: string }[] }
  media_attachments: Mastodon.Status['media_attachments']
  emojis: Mastodon.Status['emojis']
}

/**
 * Reconstructs the full edit timeline for a status as a `StatusEdit[]`,
 * oldest-first and including the original version, matching
 * `GET /api/v1/statuses/:id/history`.
 *
 * Each prior version is a per-revision snapshot in `status_history` carrying
 * its own text/summary/sensitive/media/poll-options. Rows written before
 * snapshotting existed carry null in the extended fields; those fall back to
 * the status's current values. Only `emojis` is still taken from the live
 * status for every revision.
 */
type RevisionSnapshot = Pick<
  StatusEditRevision,
  'text' | 'summary' | 'sensitive' | 'attachments' | 'pollOptions'
>

export const getMastodonStatusEdits = async (
  database: Database,
  status: StatusNote | StatusPoll,
  currentActorId?: string
): Promise<MastodonStatusEdit[]> => {
  const current = await getMastodonStatus(database, status, currentActorId)
  if (!current) return []

  const host = getConfig().host
  const currentPollOptions =
    status.type === StatusType.enum.Poll
      ? status.choices.map((choice) => choice.title)
      : null

  const buildEdit = (
    revision: RevisionSnapshot,
    createdAtMs: number
  ): MastodonStatusEdit => {
    // Legacy rows (written before per-revision snapshots) carry null in the
    // extended fields; fall back to the status's current values for those.
    const sensitive = revision.sensitive ?? status.sensitive ?? false
    const pollOptions = revision.pollOptions ?? currentPollOptions
    return {
      content: processStatusText(host, {
        ...status,
        text: revision.text,
        summary: revision.summary
      } as Status),
      spoiler_text: revision.summary ?? '',
      // Mastodon forces sensitive=true whenever the revision carries a content
      // warning, mirroring the live-status serializer.
      sensitive:
        sensitive || Boolean(revision.summary && revision.summary.length > 0),
      created_at: getISOTimeUTC(createdAtMs),
      account: current.account,
      ...(pollOptions
        ? { poll: { options: pollOptions.map((title) => ({ title })) } }
        : {}),
      // getMastodonAttachment returns null for attachments it cannot serialize
      // (non image/video); drop those like the timeline serializer effectively
      // does rather than emitting null entries.
      media_attachments: revision.attachments
        ? (revision.attachments
            .map((attachment) => getMastodonAttachment(attachment))
            .filter(
              (attachment) => attachment !== null
            ) as Mastodon.Status['media_attachments'])
        : current.media_attachments,
      emojis: current.emojis
    }
  }

  const currentRevision: RevisionSnapshot = {
    text: status.text,
    summary: status.summary ?? null,
    sensitive: status.sensitive ?? false,
    attachments: status.attachments,
    pollOptions: currentPollOptions
  }

  const revisions = await database.getStatusEditHistory({ statusId: status.id })
  if (revisions.length === 0) {
    // Never edited: history is the single original/current version.
    return [buildEdit(currentRevision, status.createdAt)]
  }

  const edits: MastodonStatusEdit[] = []
  // The original version's content is the oldest snapshot, created when the
  // status itself was created.
  edits.push(buildEdit(revisions[0], status.createdAt))
  // Each later prior version was created at the moment the version before it
  // was superseded.
  for (let i = 1; i < revisions.length; i++) {
    edits.push(buildEdit(revisions[i], revisions[i - 1].supersededAt))
  }
  // The current (live) version was created when the last prior version was
  // superseded.
  edits.push(
    buildEdit(currentRevision, revisions[revisions.length - 1].supersededAt)
  )
  return edits
}

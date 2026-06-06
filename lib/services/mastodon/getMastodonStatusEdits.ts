import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
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
 * Storage only snapshots the text/summary of each prior version (in
 * `status_history`), so per-revision media, poll options, and emojis are
 * approximated with the status's current values. Only the textual content and
 * timestamps differ between revisions.
 */
export const getMastodonStatusEdits = async (
  database: Database,
  status: StatusNote | StatusPoll,
  currentActorId?: string
): Promise<MastodonStatusEdit[]> => {
  const current = await getMastodonStatus(database, status, currentActorId)
  if (!current) return []

  const host = getConfig().host
  const pollOptions =
    status.type === StatusType.enum.Poll
      ? { options: status.choices.map((choice) => ({ title: choice.title })) }
      : undefined

  const buildEdit = (
    text: string,
    summary: string | null,
    createdAtMs: number
  ): MastodonStatusEdit => ({
    content: processStatusText(host, { ...status, text, summary } as Status),
    spoiler_text: summary ?? '',
    // Mastodon stores a dedicated sensitive flag per revision; storage here only
    // snapshots text/summary, so use the status's current sensitive flag,
    // forced true when this revision carries a content warning.
    sensitive:
      (status.sensitive ?? false) || Boolean(summary && summary.length > 0),
    created_at: getISOTimeUTC(createdAtMs),
    account: current.account,
    ...(pollOptions ? { poll: pollOptions } : {}),
    media_attachments: current.media_attachments,
    emojis: current.emojis
  })

  const revisions = await database.getStatusEditHistory({ statusId: status.id })
  if (revisions.length === 0) {
    // Never edited: history is the single original/current version.
    return [buildEdit(status.text, status.summary ?? null, status.createdAt)]
  }

  const edits: MastodonStatusEdit[] = []
  // The original version's content is the oldest snapshot, created when the
  // status itself was created.
  edits.push(
    buildEdit(revisions[0].text, revisions[0].summary, status.createdAt)
  )
  // Each later prior version was created at the moment the version before it
  // was superseded.
  for (let i = 1; i < revisions.length; i++) {
    edits.push(
      buildEdit(
        revisions[i].text,
        revisions[i].summary,
        revisions[i - 1].supersededAt
      )
    )
  }
  // The current (live) version was created when the last prior version was
  // superseded.
  edits.push(
    buildEdit(
      status.text,
      status.summary ?? null,
      revisions[revisions.length - 1].supersededAt
    )
  )
  return edits
}

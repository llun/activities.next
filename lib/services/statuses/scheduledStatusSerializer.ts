import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
import { ScheduledStatusData } from '@/lib/types/database/operations'
import { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'
import {
  ScheduledStatus,
  ScheduledStatusParams
} from '@/lib/types/mastodon/scheduledStatus'

// The subset of the parsed `POST /api/v1/statuses` body the scheduled branch
// needs to persist. Mirrors the route's NoteSchema output (after Zod defaults).
export interface ScheduledStatusInput {
  status: string
  spoiler_text?: string
  visibility?: 'public' | 'unlisted' | 'private' | 'direct'
  language?: string
  sensitive: boolean
  in_reply_to_id?: string
  media_ids: string[]
  scheduled_at?: string
  poll?: {
    options: string[]
    expires_in: number
    multiple: boolean
    hide_totals: boolean
  }
}

// Builds the complete Mastodon `params` payload stored alongside a scheduled
// status. Every key the ScheduledStatusParams schema requires is present;
// absent client fields are normalised to null and `with_rate_limit` defaults to
// false. media_ids are de-duplicated (matching the immediate-post path) and an
// empty list is stored as null so the serializer can short-circuit hydration.
export const buildScheduledParams = (
  note: ScheduledStatusInput,
  idempotencyKey: string | null
): ScheduledStatusParams => {
  const mediaIds = [...new Set(note.media_ids)]
  return {
    text: note.status,
    poll: note.poll
      ? {
          options: note.poll.options,
          expires_in: note.poll.expires_in,
          multiple: note.poll.multiple,
          hide_totals: note.poll.hide_totals
        }
      : null,
    media_ids: mediaIds.length > 0 ? mediaIds : null,
    sensitive: note.sensitive,
    spoiler_text: note.spoiler_text ?? null,
    visibility: note.visibility ?? 'public',
    in_reply_to_id: note.in_reply_to_id ?? null,
    language: note.language ?? null,
    application_id: null,
    scheduled_at: note.scheduled_at ?? null,
    idempotency: idempotencyKey,
    with_rate_limit: false
  }
}

// Resolves the stored media ids to Mastodon MediaAttachment entities using the
// same lookup + serializer the /api/v1/media routes use. Media that can no
// longer be found (deleted before the scheduled status fires) is skipped.
const hydrateMediaAttachments = async (
  database: Database,
  actorId: string,
  mediaIds: string[]
): Promise<MediaAttachment[]> => {
  if (mediaIds.length === 0) return []

  const actor = await database.getActorFromId({ id: actorId })
  const accountId = actor?.account?.id
  if (!accountId) return []

  const host = getConfig().host
  const attachments: MediaAttachment[] = []
  for (const mediaId of mediaIds) {
    const media = await database.getMediaByIdForAccount({ mediaId, accountId })
    if (!media) continue
    attachments.push(MediaAttachment.parse(getMediaAttachment(media, host)))
  }
  return attachments
}

// Maps a stored scheduled status row to the Mastodon ScheduledStatus entity,
// hydrating media_attachments from the persisted params.media_ids.
export const toMastodonScheduledStatus = async (
  database: Database,
  scheduled: ScheduledStatusData
): Promise<ScheduledStatus> => {
  const mediaAttachments = await hydrateMediaAttachments(
    database,
    scheduled.actorId,
    scheduled.params.media_ids ?? []
  )

  return ScheduledStatus.parse({
    id: scheduled.id,
    scheduled_at: new Date(scheduled.scheduledAt).toISOString(),
    params: scheduled.params,
    media_attachments: mediaAttachments
  })
}

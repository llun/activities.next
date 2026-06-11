import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
import { ScheduledStatusData } from '@/lib/types/database/operations'
import { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'
import {
  ScheduledStatus,
  ScheduledStatusParams
} from '@/lib/types/mastodon/scheduledStatus'
import { Visibility } from '@/lib/types/mastodon/visibility'

// Seconds of delay between now and the scheduled time, floored and clamped at
// zero. Shared by the enqueue sites (POST create, PUT reschedule) and the
// publish job's early re-enqueue so the delay is computed identically.
export const scheduledDelaySeconds = (scheduledAt: number): number =>
  Math.max(0, Math.floor((scheduledAt - Date.now()) / 1000))

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
// When the client omits visibility, fall back to the actor's default privacy
// (passed by the caller) so a scheduled status is stored — and later published
// — with the user's configured visibility rather than always public.
// applicationId persists the OAuth client that scheduled the status so the
// "posted via …" attribution survives to publish time.
export const buildScheduledParams = (
  note: ScheduledStatusInput,
  idempotencyKey: string | null,
  defaultPrivacy: Visibility = 'public',
  applicationId: string | null = null
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
    visibility: note.visibility ?? defaultPrivacy,
    in_reply_to_id: note.in_reply_to_id ?? null,
    language: note.language ?? null,
    application_id: applicationId,
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
  mediaIds: string[],
  accountId?: string
): Promise<MediaAttachment[]> => {
  if (mediaIds.length === 0) return []

  // Callers that already hold the owning actor (the actor-scoped routes) pass
  // its accountId so we skip the actor lookup — avoids an extra query per item
  // when serializing a whole list page.
  const resolvedAccountId =
    accountId ?? (await database.getActorFromId({ id: actorId }))?.account?.id
  if (!resolvedAccountId) return []

  const host = getConfig().host
  // Batch the lookup (single WHERE IN) instead of one query per id, then
  // re-order to match the stored media_ids and drop any that no longer resolve.
  const found = await database.getMediaByIdsForAccount({
    mediaIds,
    accountId: resolvedAccountId
  })
  const byId = new Map(found.map((media) => [String(media.id), media]))
  const attachments: MediaAttachment[] = []
  for (const mediaId of mediaIds) {
    const media = byId.get(String(mediaId))
    if (!media) continue
    attachments.push(MediaAttachment.parse(getMediaAttachment(media, host)))
  }
  return attachments
}

// Maps a stored scheduled status row to the Mastodon ScheduledStatus entity,
// hydrating media_attachments from the persisted params.media_ids.
export const toMastodonScheduledStatus = async (
  database: Database,
  scheduled: ScheduledStatusData,
  accountId?: string
): Promise<ScheduledStatus> => {
  const mediaAttachments = await hydrateMediaAttachments(
    database,
    scheduled.actorId,
    scheduled.params.media_ids ?? [],
    accountId
  )

  return ScheduledStatus.parse({
    id: scheduled.id,
    scheduled_at: new Date(scheduled.scheduledAt).toISOString(),
    params: scheduled.params,
    media_attachments: mediaAttachments
  })
}

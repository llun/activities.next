import { createHash } from 'node:crypto'

import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import type {
  ImportMapperContext,
  ImportedAttachment,
  ImportedEdit,
  ImportedTag
} from '@/lib/services/accountImport/mappers/types'
import type { Mention } from '@/lib/types/activitypub'
import type { Actor } from '@/lib/types/domain/actor'
import {
  type MastodonVisibility,
  getVisibility
} from '@/lib/utils/getVisibility'

import { MAX_FUTURE_SKEW_MS } from './timeSkew'

// The tags table's name and value columns are varchar(255) on PostgreSQL.
// The archive schemas allow more (a tag name up to 1,024 characters, an href
// up to 4,096), so an over-long tag would fail the whole status write. The
// mapper truncates to the column size instead.
const TAG_COLUMN_MAX_LENGTH = 255
// statuses.reply is varchar(255); no column holds a longer URI, and storing
// a truncated one would write an invalid URI, so a kept parent URI that
// does not fit skips the item instead.
const REPLY_COLUMN_MAX_LENGTH = 255

const clampToColumn = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : value.slice(0, maxLength)

export const normalizeRecipients = (
  value: string | string[] | null | undefined
) =>
  value === undefined || value === null
    ? []
    : typeof value === 'string'
      ? [value]
      : value

export const parsePublished = (
  value: string | null | undefined,
  nowMs: number
): number | null => {
  if (!value) return null
  const published = Date.parse(value)
  if (!Number.isFinite(published) || published > nowMs + MAX_FUTURE_SKEW_MS) {
    return null
  }
  return published
}

// The hash input binds the id to the IMPORTING actor as well as the source:
// sha256(actorId + '\0' + sourceId). Without the actor id, an archive carrying
// another account's source ids would let its importer pre-empt that account's
// own publicIds (the unique index then breaks the rightful owner's import).
export const deterministicPublicId = (
  actorId: string,
  sourceId: string,
  published: number
): string => {
  const timestamp = Number.isFinite(published)
    ? Math.max(0, Math.min(Math.floor(published), 0xffffffffffff))
    : 0
  const timestampHex = timestamp.toString(16).padStart(12, '0')
  const hash = createHash('sha256')
    .update(actorId)
    .update('\0')
    .update(sourceId)
    .digest('hex')
  const randA = hash.slice(0, 3)
  const variant = (0x8 | (Number.parseInt(hash[3], 16) & 0x3)).toString(16)
  const randBHead = hash.slice(4, 7)
  const randBTail = hash.slice(7, 19)
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8)}-7${randA}-${variant}${randBHead}-${randBTail}`
}

export const buildRecipients = (
  actor: Actor,
  mentions: Mention[],
  visibility: MastodonVisibility
) => {
  if (visibility === 'direct') return { to: [actor.id], cc: [] }
  return {
    to: statusRecipientsTo(actor, mentions, null, visibility),
    cc: statusRecipientsCC(actor, mentions, null, visibility)
  }
}

export const deriveMastodonVisibility = (
  to: string[],
  cc: string[],
  sourceFollowersUrl: string | null | undefined
) => getVisibility(to, cc, sourceFollowersUrl)

export const isDirectMessage = (
  to: string[],
  cc: string[],
  sourceFollowersUrl: string | null | undefined,
  sourceActorId: string | undefined
) => {
  const recipients = [...to, ...cc]
  return (
    getVisibility(to, cc, sourceFollowersUrl) === 'direct' &&
    recipients.some((id) => id !== sourceActorId)
  )
}

export const replyReference = (
  parentId: string | null,
  context: ImportMapperContext
):
  | {
      ok: true
      replyToStatusId: string | null
      externalReplyUri: string | null
    }
  | { ok: false; reason: 'reply-to-other' | 'reply-uri-too-long' } => {
  if (!parentId || context.ownStatusIds.has(parentId)) {
    return {
      ok: true,
      replyToStatusId: parentId,
      externalReplyUri: null
    }
  }
  if (context.repliesToOthers === 'keep') {
    if (parentId.length > REPLY_COLUMN_MAX_LENGTH) {
      return { ok: false, reason: 'reply-uri-too-long' }
    }
    return {
      ok: true,
      replyToStatusId: null,
      externalReplyUri: parentId
    }
  }
  return { ok: false, reason: 'reply-to-other' }
}

export const buildTags = (
  tags: {
    type: string
    name: string
    href?: string | null
    value?: string
    iconUrl?: string | null
  }[]
): ImportedTag[] =>
  tags.flatMap<ImportedTag>((tag) => {
    if (tag.type.toLowerCase() === 'hashtag') {
      return [
        {
          type: 'hashtag' as const,
          name: clampToColumn(tag.name, TAG_COLUMN_MAX_LENGTH),
          value: clampToColumn(
            tag.href ?? tag.value ?? '',
            TAG_COLUMN_MAX_LENGTH
          )
        }
      ]
    }
    if (tag.type.toLowerCase() === 'mention') {
      return [
        {
          type: 'mention' as const,
          name: clampToColumn(tag.name, TAG_COLUMN_MAX_LENGTH),
          value: clampToColumn(
            tag.href ?? tag.value ?? '',
            TAG_COLUMN_MAX_LENGTH
          )
        }
      ]
    }
    if (tag.type.toLowerCase() === 'emoji') {
      return [
        {
          type: 'emoji' as const,
          name: clampToColumn(tag.name, TAG_COLUMN_MAX_LENGTH),
          value: clampToColumn(
            tag.iconUrl ?? tag.value ?? '',
            TAG_COLUMN_MAX_LENGTH
          )
        }
      ]
    }
    return []
  })

export const buildAttachments = (
  attachments: {
    mediaId?: string | number | null
    url: string
    mediaType: string
    name?: string | null
    width?: number
    height?: number
    thumbnailUrl?: string | null
  }[]
): ImportedAttachment[] =>
  attachments.map((attachment) => ({
    mediaId:
      attachment.mediaId === undefined || attachment.mediaId === null
        ? null
        : String(attachment.mediaId),
    sourceUrl: attachment.url,
    mediaType: attachment.mediaType,
    name: attachment.name ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    thumbnailUrl: attachment.thumbnailUrl ?? null
  }))

export const parseEditedAt = (value: string): number => Date.parse(value)

// An archived edit's supersede time is untrusted: a crafted future (or
// non-finite) value would reach statuses.updatedAt and be reported as
// edited_at in the future, and one before the status's own published time
// would predate the status it edited. The same bound parsePublished applies
// to the published time is applied here, plus the published floor.
export const buildEdits = (
  edits: {
    text: string
    summary: string | null
    sensitive: boolean | null
    attachments: Parameters<typeof buildAttachments>[0] | null
    pollOptions: string[] | null
    supersededAt: string
  }[],
  nowMs: number,
  published: number
): ImportedEdit[] =>
  edits.flatMap((edit) => {
    const supersededAt = parseEditedAt(edit.supersededAt)
    if (
      !Number.isFinite(supersededAt) ||
      supersededAt > nowMs + MAX_FUTURE_SKEW_MS ||
      supersededAt < published
    ) {
      return []
    }
    return [
      {
        text: edit.text,
        summary: edit.summary,
        sensitive: edit.sensitive,
        attachments: edit.attachments
          ? buildAttachments(edit.attachments)
          : null,
        pollOptions: edit.pollOptions,
        supersededAt
      }
    ]
  })

export const sourceVisibilityToRecipients = (
  sourceTo: string[],
  sourceCc: string[],
  sourceFollowersUrl: string | null | undefined,
  actor: Actor,
  mentions: Mention[]
) => {
  const visibility = deriveMastodonVisibility(
    sourceTo,
    sourceCc,
    sourceFollowersUrl
  )
  return { visibility, ...buildRecipients(actor, mentions, visibility) }
}

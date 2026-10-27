import type { Actor } from '@/lib/types/domain/actor'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

export type ImportedTag = {
  type: 'hashtag' | 'mention' | 'emoji'
  name: string
  value: string
}

export type ImportedAttachment = {
  /** The target instance's media id, supplied after the caller saves media. */
  mediaId: string | null
  /** Archive-only reference. The status writer never fetches this URL. */
  sourceUrl: string
  mediaType: string
  name: string | null
  width: number | null
  height: number | null
  thumbnailUrl: string | null
}

export type ImportedEdit = {
  text: string
  summary: string | null
  sensitive: boolean | null
  attachments: ImportedAttachment[] | null
  pollOptions: string[] | null
  supersededAt: number
}

export type ImportedStatusInput = {
  sourceId: string
  sourceUrl: string | null
  publicId: string
  published: number
  visibility: MastodonVisibility
  to: string[]
  cc: string[]
  text: string
  summary: string | null
  sensitive: boolean
  language: string | null
  replyToStatusId: string | null
  externalReplyUri: string | null
  quoteSourceId: string | null
  /** The caller rewrites this source reference to the target status id. */
  quoteStatusId: string | null
  quoteApprovalPolicy: 'public' | 'followers' | 'nobody'
  tags: ImportedTag[]
  attachments: ImportedAttachment[]
  poll: {
    pollType: 'oneOf' | 'anyOf'
    choices: { title: string; totalVotes: number }[]
    endAt: number
    hideTotals: boolean
  } | null
  pinned: boolean
  edits: ImportedEdit[]
}

export type ImportMapperContext = {
  actor: Actor
  ownStatusIds: ReadonlySet<string>
  nowMs: number
  /** The archive's own actor id (its actor.json / profile id). */
  sourceActorId?: string
  sourceFollowersUrl?: string | null
  repliesToOthers?: 'skip' | 'keep'
}

export type ImportSkipReason =
  | 'boost'
  | 'reply-to-other'
  | 'reply-uri-too-long'
  | 'direct'
  | 'bad-date'
  | 'invalid'
  | 'foreign-author'

export type ImportMapperResult =
  | { ok: true; input: ImportedStatusInput }
  | { ok: false; reason: ImportSkipReason }

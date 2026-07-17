// This schema is base on https://docs.joinmastodon.org/entities/Status/
import { z } from 'zod'

import { Account } from '@/lib/types/mastodon/account'
import { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import { FilterResult } from '@/lib/types/mastodon/filterResult'
import { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment/index'
import { Poll } from '@/lib/types/mastodon/poll/index'
import { PreviewCard } from '@/lib/types/mastodon/previewCard'
import { Visibility } from '@/lib/types/mastodon/visibility'

import { Application } from './application'
import { Mention } from './mention'
import { Tag } from './tag'

// Quote lifecycle state (Mastodon 4.5 Quote entity). Nine values: the five
// persisted states plus four viewer-relative ones. The serializer currently
// computes `deleted` (target gone) and `unauthorized` (viewer cannot read the
// target); the block/mute-relative states (`blocked_account`, `blocked_domain`,
// `muted_account`) are part of the vocabulary — clients may receive them from
// other servers — but are not yet emitted locally. Unknown values are treated
// as `unauthorized` by clients.
export const MastodonQuoteState = z.enum([
  'pending',
  'accepted',
  'rejected',
  'revoked',
  'deleted',
  'unauthorized',
  'blocked_account',
  'blocked_domain',
  'muted_account'
])
export type MastodonQuoteState = z.infer<typeof MastodonQuoteState>

// Who may quote a status and where the current viewer stands. `automatic`/
// `manual` carry the approved policy audiences; `current_user` is one of
// automatic | manual | denied | unknown.
export const QuoteApproval = z.object({
  automatic: z.string().array(),
  manual: z.string().array(),
  current_user: z.string()
})
export type QuoteApproval = z.infer<typeof QuoteApproval>

// Nested quote reference used at depth >= 1 to stop recursion: the quoted status
// is referenced by id only.
export const ShallowQuote = z.object({
  state: MastodonQuoteState,
  quoted_status_id: z.string().nullable()
})
export type ShallowQuote = z.infer<typeof ShallowQuote>

export const BaseStatus = z.object({
  id: z
    .string()
    .describe(
      'ID of the status in the database, for Mastodon, it is numeric casting to string. For Activities.next, this is equal to status URI'
    ),
  uri: z.string().describe('URI of the status used for federation'),

  account: Account.describe('The actor that authored the status'),

  content: z.string().describe('HTML-encoded status content'),
  visibility: Visibility.describe('Visibility of this status'),
  sensitive: z
    .boolean()
    .describe('Is this status marked as sensitive content?'),
  spoiler_text: z
    .string()
    .describe(
      'Subject or summary line, below which status content is collapsed until expanded'
    ),

  media_attachments: MediaAttachment.array(),
  application: Application.nullable().optional(),
  emojis: CustomEmoji.array().describe(
    'Custom emoji to be used when rendering status content'
  ),

  mentions: Mention.array().describe(
    'Mentions of users within the status content'
  ),
  tags: Tag.array().describe('Hashtags used within the status content'),

  reblogs_count: z
    .number()
    .describe('How many boosts this status has received'),
  favourites_count: z
    .number()
    .describe('How many favourites this status has received'),
  replies_count: z
    .number()
    .describe('How many replies this status has received'),

  url: z
    .string()
    .describe("A link to the status's HTML representation")
    .nullable(),
  in_reply_to_id: z
    .string()
    .describe('ID of the status being replied to')
    .nullable(),
  in_reply_to_account_id: z
    .string()
    .describe('ID of the actor that authored the status being replied to')
    .nullable(),

  poll: Poll.nullable().describe('The poll attached to the status'),
  card: PreviewCard.nullable().describe(
    'Preview card for links included within status content'
  ),

  language: z
    .string()
    .describe(
      'Primary language of this status in ISO 639 Part 1 two-letter language code'
    )
    .nullable(),

  text: z
    .string()
    .describe(
      'Plain-text source of a status. Returned instead of `content` when status is deleted, so the user may redraft from the source text without the client having to reverse-engineer the original text from the HTML content'
    )
    .nullable(),

  created_at: z
    .string()
    .describe(
      'The date when this status was created in ISO 8601 Datetime format'
    ),
  edited_at: z
    .string()
    .describe(
      'Timestamp of when the status was last edited in ISO 8601 Datetime format'
    )
    .nullable(),

  favourited: z
    .boolean()
    .describe(
      'If the current token has an authorized user: Have you favourited this status?'
    )
    .optional(),
  reblogged: z
    .boolean()
    .describe(
      'If the current token has an authorized user: Have you boosted this status?'
    )
    .optional(),
  muted: z
    .boolean()
    .describe(
      "If the current token has an authorized user: Have you muted notifications for this status's conversation?"
    )
    .optional(),
  bookmarked: z
    .boolean()
    .describe(
      'If the current token has an authorized user: Have you bookmarked this status?'
    )
    .optional(),
  pinned: z
    .boolean()
    .describe(
      'If the current token has an authorized user: Have you pinned this status? Only appears if the status is pinnable'
    )
    .optional(),
  filtered: FilterResult.array()
    .optional()
    .describe(
      'If the current token has an authorized user: The filters and keywords that matched this status'
    ),

  // Quote post (FEP-044f / Mastodon 4.5). At depth 0 this is a full Quote whose
  // `quoted_status` embeds the quoted status (serialized at depth 1); at depth
  // >= 1 it is a ShallowQuote referencing the quoted status by id only. The
  // `quoted_status` reference is a lazy self-reference broken with an explicit
  // return type so the recursive schema still infers.
  quote: z
    .union([
      z.object({
        state: MastodonQuoteState,
        quoted_status: z.lazy((): z.ZodType => BaseStatus).nullable()
      }),
      ShallowQuote
    ])
    .nullable()
    .optional()
    .describe('The status this status quotes'),
  quote_approval: QuoteApproval.optional().describe(
    'Who may quote this status and where the current viewer stands'
  )
})
export type BaseStatus = z.infer<typeof BaseStatus>

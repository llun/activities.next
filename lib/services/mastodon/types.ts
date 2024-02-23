import { z } from 'zod'

export const MastodonEmoji = z.object({
  shortcode: z.string(),
  url: z.string(),
  static_url: z.string(),
  visible_in_picker: z.boolean()
})
export type MastodonEmoji = z.infer<typeof MastodonEmoji>

export const MastodonField = z.object({
  name: z.string(),
  value: z.string(),
  verified_at: z.string().nullable(),
  url: z.string()
})
export type MastodonField = z.infer<typeof MastodonField>

export const MastodonSource = z.object({
  privacy: z.string(),
  sensitive: z.boolean(),
  language: z.string(),
  note: z.string(),
  fields: z.array(z.unknown()),
  follow_requests_count: z.number()
})
export type MastodonSource = z.infer<typeof MastodonSource>

export const MastodonAttachment = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  preview_url: z.string(),
  remote_url: z.string(),
  preview_remote_url: z.string().nullable(),
  text_url: z.string().nullable(),
  meta: z.object({
    focus: z.object({
      x: z.number(),
      y: z.number()
    }),
    original: z.object({
      width: z.number(),
      height: z.number(),
      size: z.string(),
      aspect: z.number()
    }),
    small: z.object({
      width: z.number(),
      height: z.number(),
      size: z.string(),
      aspect: z.number()
    })
  }),
  description: z.string(),
  blurhash: z.string()
})
export type MastodonAttachment = z.infer<typeof MastodonAttachment>

export const MastodonMention = z.object({
  id: z.string(),
  username: z.string(),
  url: z.string(),
  acct: z.string()
})
export type MastodonMention = z.infer<typeof MastodonMention>

export const MastodonApplication = z.object({
  name: z.string(),
  website: z.string().optional()
})
export type MastodonApplication = z.infer<typeof MastodonApplication>

export const MastodonTag = z.object({
  name: z.string(),
  url: z.string()
})
export type MastodonTag = z.infer<typeof MastodonTag>

export const MastodonAccount = z.object({
  id: z.string(),
  username: z.string(),
  acct: z.string(),
  display_name: z.string(),
  locked: z.boolean(),
  bot: z.boolean().nullable(),
  discoverable: z.boolean().nullable(),
  group: z.boolean().nullable(),
  created_at: z.string(),
  note: z.string(),
  url: z.string(),
  uri: z.string(),
  avatar: z.string(),
  avatar_static: z.string(),
  header: z.string(),
  header_static: z.string(),
  followers_count: z.number(),
  following_count: z.number(),
  statuses_count: z.number(),
  last_status_at: z.string(),
  source: MastodonSource,
  emojis: MastodonEmoji.array(),
  fields: MastodonField.array().nullable()
})
export type MastodonAccount = z.infer<typeof MastodonAccount>

export const MastodonCard = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
  language: z.string(),
  type: z.string(),
  author_name: z.string(),
  author_url: z.string(),
  provider_name: z.string(),
  provider_url: z.string(),
  html: z.string(),
  width: z.number(),
  height: z.number(),
  image: z.string(),
  image_description: z.string(),
  embed_url: z.string(),
  blurhash: z.string(),
  published_at: z.string().nullable()
})
export type MastodonCard = z.infer<typeof MastodonCard>

export const MastodonStatus = z.object({
  id: z.string(),
  created_at: z.string(),
  in_reply_to_id: z.string().nullable(),
  in_reply_to_account_id: z.string().nullable(),
  sensitive: z.boolean(),
  spoiler_text: z.string().nullable(),
  visibility: z.string(),
  language: z.string().nullable(),
  uri: z.string(),
  url: z.string().nullable(),
  replies_count: z.number(),
  reblogs_count: z.number(),
  reblog: z.null(),
  favourites_count: z.number(),
  edited_at: z.string().nullable(),
  favourited: z.boolean(),
  reblogged: z.boolean(),
  muted: z.boolean(),
  bookmarked: z.boolean(),
  content: z.string(),
  filtered: z.array(z.string()),
  account: MastodonAccount,
  media_attachments: MastodonAttachment.array().optional(),
  mentions: MastodonMention.array().optional(),
  tags: MastodonTag.array().optional(),
  emojis: MastodonEmoji.array().optional(),
  card: MastodonCard.nullable(),
  poll: z.unknown().nullable(),
  application: MastodonApplication.nullable()
})
export type MastodonStatus = z.infer<typeof MastodonStatus>

export const ReblogMastodonStatus = MastodonStatus.extend({
  reblog: MastodonStatus
})
export type ReblogMastodonStatus = z.infer<typeof ReblogMastodonStatus>

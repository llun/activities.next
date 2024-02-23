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
  type: z.enum(['image', 'video', 'gifv', 'audio']),
  url: z.string(),
  preview_url: z.string(),
  remote_url: z.string().optional(),
  text_url: z.string().optional(),
  description: z.string().optional(),
  blurhash: z.string().optional()
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
  bot: z.boolean(),
  created_at: z.string(),
  note: z.string(),
  url: z.string(),
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

export const MastodonStatus = z.object({
  id: z.string(),
  uri: z.string(),
  url: z.string(),
  account: MastodonAccount,
  content: z.string(),
  created_at: z.string(),
  emojis: MastodonEmoji.array(),
  replies_count: z.number(),
  reblogs_count: z.number(),
  favourites_count: z.number(),
  reblogged: z.boolean().nullable(),
  favourited: z.boolean().nullable(),
  muted: z.boolean().nullable(),
  sensitive: z.boolean(),
  spoiler_text: z.string().nullable(),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
  media_attachments: MastodonAttachment.array().nullable(),
  mentions: MastodonMention.array().nullable(),
  tags: MastodonTag.array().nullable(),
  application: MastodonApplication.nullable()
})
export type MastodonStatus = z.infer<typeof MastodonStatus>

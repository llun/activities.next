// This schema is based on https://docs.joinmastodon.org/entities/Profile/
// (Mastodon 4.6, API version 8): the raw-value profile shape returned by
// GET/PATCH /api/v1/profile. Unlike Account, the text fields carry raw
// unprocessed values and avatar/header are null when unset.
import { z } from 'zod'

import { Field } from './field'

export const Profile = z.object({
  id: z.string().describe('The account id, the same value as Account#id'),
  display_name: z
    .string()
    .describe('The raw display name, before any processing'),
  note: z
    .string()
    .describe('The raw unprocessed bio text, not the rendered HTML'),
  fields: Field.array().describe('Raw profile metadata name/value pairs'),
  avatar: z
    .string()
    .describe('URL of the avatar image, null when the account has none')
    .nullable(),
  avatar_static: z.string().describe('Static version of `avatar`').nullable(),
  avatar_description: z
    .string()
    .describe('Alt text describing the avatar, empty string when unset'),
  header: z
    .string()
    .describe('URL of the header image, null when the account has none')
    .nullable(),
  header_static: z.string().describe('Static version of `header`').nullable(),
  header_description: z
    .string()
    .describe('Alt text describing the header, empty string when unset'),
  locked: z.boolean().describe('Whether follow requests need manual approval'),
  bot: z.boolean().describe('Whether the account is automated'),
  hide_collections: z
    .boolean()
    .describe('Whether the account hides its follows/followers collections')
    .nullable(),
  discoverable: z
    .boolean()
    .describe('Whether the account opted into discovery features')
    .nullable(),
  indexable: z
    .boolean()
    .describe('Whether public posts may be indexed by search engines'),
  show_media: z.boolean().describe('Whether to show the profile Media tab'),
  show_media_replies: z
    .boolean()
    .describe('Whether replies are included in the profile Media tab'),
  show_featured: z
    .boolean()
    .describe('Whether to show the profile Featured tab'),
  attribution_domains: z
    .string()
    .array()
    .describe('Domains allowed to credit this account for articles')
})
export type Profile = z.infer<typeof Profile>

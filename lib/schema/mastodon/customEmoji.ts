// This schema is base on https://docs.joinmastodon.org/entities/CustomEmoji/
import { z } from 'zod'

export const CustomEmoji = z.object({
  shortcode: z.string().describe('The name of the custom emoji'),
  static_url: z
    .string()
    .describe('A link to a static copy of the custom emoji'),
  url: z.string().describe('A link to the custom emoji'),
  visible_in_picker: z
    .boolean()
    .describe('Whether this Emoji should be visible in the picker or unlisted'),
  category: z
    .string()
    .describe('Used for sorting custom emoji in the picker')
    .nullable()
})
export type CustomEmoji = z.infer<typeof CustomEmoji>

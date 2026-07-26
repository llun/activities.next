import { z } from 'zod'

/**
 * One emoji reaction rollup on a status.
 *
 * This is an **ecosystem extension**, not part of the core Mastodon API. The
 * exact same object is served under two names so both dialects in the wild read
 * it from one store: `pleroma.emoji_reactions` (Pleroma/Akkoma — what Husky and
 * the Megalodon-family clients consume) and `reactions` (the glitch-soc
 * reaction dialect). Vanilla Mastodon clients simply ignore both.
 */
export const StatusReaction = z.object({
  name: z
    .string()
    .describe(
      'A unicode emoji, a local custom-emoji shortcode, or `shortcode@domain` for a remote custom emoji'
    ),
  count: z.number().describe('How many actors reacted with this emoji'),
  me: z
    .boolean()
    .describe(
      'If the current token has an authorized user: did you react with this emoji?'
    ),
  url: z
    .string()
    .nullable()
    .describe('Image for a custom emoji; null for a unicode emoji'),
  static_url: z
    .string()
    .nullable()
    .describe('Static image for a custom emoji; null for a unicode emoji')
})
export type StatusReaction = z.infer<typeof StatusReaction>

import { getConfig } from '@/lib/config'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Outbound reactions are emitted in the Misskey shape — a `Like` carrying the
// emoji on both `content` and `_misskey_reaction`, plus an `Emoji` tag for a
// custom one — because it is the only spelling every server family renders
// something for:
//
// - Misskey / Firefish / Sharkey read it natively.
// - Pleroma / Akkoma rewrite a `Like` with `content` into their own
//   `EmojiReact`.
// - Vanilla Mastodon has no `EmojiReact` handler at all and drops it silently,
//   but its `Like` handler ignores `content` — so the reaction degrades to a
//   plain favourite instead of vanishing.
//
// That degradation is the deliberate trade-off: the alternative (emitting
// FEP-c0e0 `EmojiReact`, which is cleaner) is invisible to most of the network.
export const REACTION_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  {
    misskey: 'https://misskey-hub.net/ns#',
    _misskey_reaction: 'misskey:_misskey_reaction',
    toot: 'http://joinmastodon.org/ns#',
    Emoji: 'toot:Emoji'
  }
]

export interface ReactionEmojiTag {
  id: string
  type: 'Emoji'
  name: string
  updated: string
  icon: {
    type: 'Image'
    mediaType?: string
    url: string
  }
}

export interface ReactionActivity {
  '@context': typeof REACTION_CONTEXT
  id: string
  type: 'Like'
  actor: string
  object: string
  content: string
  _misskey_reaction: string
  tag?: ReactionEmojiTag[]
}

export interface UndoReactionActivity {
  '@context': typeof REACTION_CONTEXT
  id: string
  type: 'Undo'
  actor: string
  object: ReactionActivity
}

/**
 * The activity id for one (actor, status, reaction). It must be distinct per
 * reaction *and* distinct from the favourite `Like` id the same actor may send
 * for the same status — otherwise a receiver that dedups by id would treat a
 * favourite and a reaction as the same activity, and an `Undo` could retract
 * the wrong one.
 */
export const reactionActivityId = (
  actorId: string,
  statusId: string,
  reaction: string,
  hash: (value: string) => string
) => `${actorId}#emoji-reactions/${hash(statusId)}/${hash(reaction)}`

/**
 * How the reaction is written on the wire: a custom emoji travels colon-wrapped
 * (`:blobcat:`), a unicode emoji as itself.
 */
export const getReactionContent = (
  reaction: string,
  customEmoji: CustomEmojiData | null
) => (customEmoji ? `:${customEmoji.shortcode}:` : reaction)

/**
 * The `Emoji` tag describing a local custom emoji, in Misskey's `renderEmoji`
 * shape, so receivers can display the image rather than the bare shortcode.
 * Unicode reactions carry no tag.
 */
export const getReactionEmojiTag = (
  customEmoji: CustomEmojiData | null
): ReactionEmojiTag | null => {
  if (!customEmoji) return null
  return {
    id: `https://${getConfig().host}/emojis/${customEmoji.shortcode}`,
    type: 'Emoji',
    name: `:${customEmoji.shortcode}:`,
    updated: getISOTimeUTC(customEmoji.updatedAt),
    icon: {
      type: 'Image',
      url: customEmoji.url
    }
  }
}

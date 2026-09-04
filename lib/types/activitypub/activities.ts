// ActivityPub Activity types
import { z } from 'zod'

import { Note, Tag } from './objects'

// ============================================================================
// Activity Type Constants
// ============================================================================

export const CreateAction = 'Create'
export type CreateAction = typeof CreateAction

export const AnnounceAction = 'Announce'
export type AnnounceAction = typeof AnnounceAction

export const UndoAction = 'Undo'
export type UndoAction = typeof UndoAction

export const DeleteAction = 'Delete'
export type DeleteAction = typeof DeleteAction

export const UpdateAction = 'Update'
export type UpdateAction = typeof UpdateAction

// ============================================================================
// Follow Activity
// ============================================================================

export const ENTITY_TYPE_FOLLOW = 'Follow'
export const Follow = z.object({
  id: z.string(),
  type: z.literal(ENTITY_TYPE_FOLLOW),
  actor: z.string(),
  object: z.string()
})

export type Follow = z.infer<typeof Follow>

// ============================================================================
// Block Activity
// ============================================================================

export const ENTITY_TYPE_BLOCK = 'Block'
export const ActivityPubObjectRef = z.union([
  z.string(),
  z.object({ id: z.string() }).passthrough()
])
export type ActivityPubObjectRef = z.infer<typeof ActivityPubObjectRef>

export const Block = z.object({
  id: z.string(),
  type: z.literal(ENTITY_TYPE_BLOCK),
  actor: z.string(),
  object: ActivityPubObjectRef
})

export type Block = z.infer<typeof Block>

// ============================================================================
// Accept Activity
// ============================================================================

export const FollowOrObjectRef = z.union([
  Follow,
  z
    .object({
      id: z.string().optional(),
      type: z.literal(ENTITY_TYPE_FOLLOW)
    })
    .passthrough(),
  z
    .object({
      id: z.string(),
      type: z.undefined().optional()
    })
    .passthrough(),
  z.string()
])
export type FollowOrObjectRef = z.infer<typeof FollowOrObjectRef>

export const Accept = z.object({
  id: z.string(),
  actor: z.string().min(1),
  type: z.literal('Accept'),
  object: FollowOrObjectRef
})

export type Accept = z.infer<typeof Accept>

// ============================================================================
// Reject Activity
// ============================================================================

export const Reject = z.object({
  id: z.string(),
  actor: z.string().min(1),
  type: z.literal('Reject'),
  object: FollowOrObjectRef
})

export type Reject = z.infer<typeof Reject>

// ============================================================================
// Like / EmojiReact Activity
// ============================================================================
//
// A `Like` is a favourite unless it carries a reaction: the Misskey family
// federates emoji reactions as a `Like` whose `content` and `_misskey_reaction`
// both hold the emoji (plus an `Emoji` tag for a custom one), while
// Pleroma/Akkoma use the litepub `EmojiReact` type from FEP-c0e0. Both shapes
// are otherwise identical, so `EmojiReact` is just `Like` with another type.
// Deciding which one a document is happens at the consumption boundary
// (`getReactionContent` in lib/actions/emojiReaction), never here — the schemas
// stay liberal per the ActivityPub & JSON-LD rules in AGENTS.md.

export const ENTITY_TYPE_LIKE = 'Like'
export const ENTITY_TYPE_EMOJI_REACT = 'EmojiReact'

export const Like = z.object({
  type: z.literal(ENTITY_TYPE_LIKE),
  id: z.string(),
  actor: z.string(),
  object: z.union([z.string(), Note]),
  // Liberal per the ActivityPub & JSON-LD rules: a sender whose document
  // carries a default language can have compaction render `content` as a
  // language-tagged object rather than a scalar. Degrade that to `undefined`
  // instead of failing the whole activity — a `Like` we cannot read a reaction
  // from is simply an ordinary favourite, which is the pre-reaction behaviour.
  content: z.string().optional().catch(undefined),
  _misskey_reaction: z.string().optional().catch(undefined),
  tag: Tag.array().optional().catch(undefined)
})

export type Like = z.infer<typeof Like>

export const EmojiReact = Like.extend({
  type: z.literal(ENTITY_TYPE_EMOJI_REACT)
})

export type EmojiReact = z.infer<typeof EmojiReact>

// ============================================================================
// Announce Activity (Boost/Reblog)
// ============================================================================

export const Announce = z.object({
  type: z.literal('Announce'),
  id: z.string(),
  actor: z.string(),

  published: z.string().describe('Object published datetime'),
  to: z.union([z.string(), z.string().array()]),
  cc: z.union([z.string(), z.string().array()]),
  object: z.string()
})
export type Announce = z.infer<typeof Announce>

// ============================================================================
// Undo Activity
// ============================================================================

// Undo of a Like/EmojiReact (favourite or reaction), Follow or Block. Announce
// undos travel a separate `ReferenceUndo`/job path, so they are not listed here.
// The union members are discriminated by their `type` literal, so order is
// irrelevant.
export const Undo = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Undo'),
  object: z.union([EmojiReact, Like, Follow, Block])
})

export type Undo = z.infer<typeof Undo>

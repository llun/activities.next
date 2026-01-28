// ActivityPub Activity types
import { z } from 'zod'

import { Note } from './objects'

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
// Accept Activity
// ============================================================================

export const Accept = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Accept'),
  object: Follow
})

export type Accept = z.infer<typeof Accept>

// ============================================================================
// Reject Activity
// ============================================================================

export const Reject = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Reject'),
  object: Follow
})

export type Reject = z.infer<typeof Reject>

// ============================================================================
// Like Activity
// ============================================================================

export const ENTITY_TYPE_LIKE = 'Like'
export const Like = z.object({
  type: z.literal(ENTITY_TYPE_LIKE),
  id: z.string(),
  actor: z.string(),
  object: z.union([z.string(), Note])
})

export type Like = z.infer<typeof Like>

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

export const Undo = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Undo'),
  object: z.union([Like, Follow])
})

export type Undo = z.infer<typeof Undo>

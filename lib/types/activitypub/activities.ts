import { z } from 'zod'

import { APNote } from './objects'

// ============================================================================
// Follow Activity
// ============================================================================

export const ENTITY_TYPE_FOLLOW = 'Follow'
export const APFollow = z.object({
  id: z.string(),
  type: z.literal(ENTITY_TYPE_FOLLOW),
  actor: z.string(),
  object: z.string()
})
export type APFollow = z.infer<typeof APFollow>

// ============================================================================
// Accept Activity
// ============================================================================

export const APAccept = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Accept'),
  object: APFollow
})
export type APAccept = z.infer<typeof APAccept>

// ============================================================================
// Reject Activity
// ============================================================================

export const APReject = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Reject'),
  object: APFollow
})
export type APReject = z.infer<typeof APReject>

// ============================================================================
// Like Activity
// ============================================================================

export const ENTITY_TYPE_LIKE = 'Like'
export const APLike = z.object({
  type: z.literal(ENTITY_TYPE_LIKE),
  id: z.string(),
  actor: z.string(),
  object: z.union([z.string(), APNote])
})
export type APLike = z.infer<typeof APLike>

// ============================================================================
// Announce Activity
// ============================================================================

export const APAnnounce = z.object({
  type: z.literal('Announce'),
  id: z.string(),
  actor: z.string(),

  published: z.string().describe('Object published datetime'),
  to: z.union([z.string(), z.string().array()]),
  cc: z.union([z.string(), z.string().array()]),
  object: z.string()
})
export type APAnnounce = z.infer<typeof APAnnounce>

// ============================================================================
// Undo Activity
// ============================================================================

export const APUndo = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Undo'),
  object: z.union([APLike, APFollow])
})
export type APUndo = z.infer<typeof APUndo>

// ============================================================================
// Action Type Constants (for activities/actions)
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
// Base Activity Interface
// ============================================================================

export interface BaseActivity {
  id: string
  actor: string
}

import { z } from 'zod'

// ============================================================================
// Collection Types
// ============================================================================

export const APCollectionPage = z.object({
  type: z.literal('CollectionPage'),
  next: z.string(),
  partOf: z.string(),
  items: z.array(z.any())
})
export type APCollectionPage = z.infer<typeof APCollectionPage>

export const APCollectionWithFirstPage = z.object({
  id: z.string(),
  type: z.literal('Collection'),
  first: z.object({
    type: z.literal('CollectionPage'),
    next: z.string(),
    partOf: z.string(),
    items: z.union([z.any(), z.array(z.any())])
  })
})
export type APCollectionWithFirstPage = z.infer<
  typeof APCollectionWithFirstPage
>

export const APCollectionWithItems = z.object({
  id: z.string(),
  type: z.literal('Collection'),
  totalItems: z.number(),
  items: z.union([z.any(), z.array(z.any())])
})
export type APCollectionWithItems = z.infer<typeof APCollectionWithItems>

export const APCollection = z.union([
  APCollectionWithFirstPage,
  APCollectionWithItems
])
export type APCollection = z.infer<typeof APCollection>

// ============================================================================
// Ordered Collection Types
// ============================================================================

export const APOrderedCollectionPage = z.object({
  id: z.string(),
  type: z.literal('OrderedCollectionPage'),
  next: z.string(),
  prev: z.string().optional(),
  partOf: z.string().optional(),
  orderedItems: z.array(z.any()).optional()
})
export type APOrderedCollectionPage = z.infer<typeof APOrderedCollectionPage>

export const APOrderedCollection = z.object({
  id: z.string(),
  type: z.literal('OrderedCollection'),
  totalItems: z.number().optional(),
  first: z.union([z.string(), APOrderedCollectionPage]).optional(),
  last: z.string().optional()
})
export type APOrderedCollection = z.infer<typeof APOrderedCollection>

export const APFeaturedOrderedCollection = z.object({
  id: z.string(),
  type: z.literal('OrderedCollection'),
  totalItems: z.number(),
  orderedItems: z.array(z.any())
})
export type APFeaturedOrderedCollection = z.infer<
  typeof APFeaturedOrderedCollection
>

// ============================================================================
// Helper Functions
// ============================================================================

export const getOrderCollectionFirstPage = (
  orderedCollection: APOrderedCollection | null
): string | null => {
  if (!orderedCollection) return null
  if (!orderedCollection.first) return null
  if (typeof orderedCollection.first === 'string') {
    return orderedCollection.first
  }
  return orderedCollection.first.id ?? null
}

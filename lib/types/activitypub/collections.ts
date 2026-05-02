// ActivityPub Collection types
import { z } from 'zod'

const CollectionType = z.enum(['Collection', 'OrderedCollection'])
const CollectionPageType = z.enum(['CollectionPage', 'OrderedCollectionPage'])

export const CollectionWithFirstPage = z.object({
  id: z.string(),
  type: CollectionType,
  first: z.object({
    type: CollectionPageType,
    next: z.string(),
    partOf: z.string(),
    items: z.union([z.any(), z.array(z.any())])
  })
})
export type CollectionWithFirstPage = z.infer<typeof CollectionWithFirstPage>

export const CollectionWithItems = z.object({
  id: z.string(),
  type: CollectionType,
  totalItems: z.number(),
  items: z.union([z.any(), z.array(z.any())])
})
export type CollectionWithItems = z.infer<typeof CollectionWithItems>

export const CollectionSummary = z.object({
  id: z.string(),
  type: CollectionType,
  totalItems: z.number()
})
export type CollectionSummary = z.infer<typeof CollectionSummary>

export const Collection = z.union([
  CollectionWithFirstPage,
  CollectionWithItems,
  CollectionSummary
])
export type Collection = z.infer<typeof Collection>

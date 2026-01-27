import { z } from 'zod'

export const CollectionWithFirstPage = z.object({
  id: z.string(),
  type: z.literal('Collection'),
  first: z.object({
    type: z.literal('CollectionPage'),
    next: z.string(),
    partOf: z.string(),
    items: z.union([z.any(), z.array(z.any())])
  })
})
export type CollectionWithFirstPage = z.infer<typeof CollectionWithFirstPage>

export const CollectionWithItems = z.object({
  id: z.string(),
  type: z.literal('Collection'),
  totalItems: z.number(),
  items: z.union([z.any(), z.array(z.any())])
})
export type CollectionWithItems = z.infer<typeof CollectionWithItems>

export const Collection = z.union([
  CollectionWithFirstPage,
  CollectionWithItems
])
export type Collection = z.infer<typeof Collection>

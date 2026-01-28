// Utility functions for OrderedCollection
// These are kept as they contain business logic, not just type definitions

export interface ContextEntity {
  '@context': string | string[]
}

export interface OrderedCollectionPage extends ContextEntity {
  id?: string
  type: 'OrderedCollectionPage'
  orderedItems: unknown[]
  next?: string
  prev?: string
}

export interface OrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems?: number
  first?: string | OrderedCollectionPage
  last?: string
}

export const getOrderCollectionFirstPage = (
  orderedCollection: OrderedCollection | null
) => {
  if (!orderedCollection) return null
  if (!orderedCollection.first) return null
  if (typeof orderedCollection.first === 'string') {
    return orderedCollection.first
  }
  return orderedCollection.first.id ?? null
}

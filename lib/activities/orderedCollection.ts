// Utility functions for OrderedCollection
// These are kept as they contain business logic, not just type definitions

export interface ContextEntity {
  '@context': string | string[]
}

export interface OrderedCollectionPage extends ContextEntity {
  id?: string
  type: 'OrderedCollectionPage'
  totalItems?: number
  orderedItems: (string | Record<string, unknown>)[]
  next?: string
  prev?: string
}

export interface OrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems?: number
  first?: string | OrderedCollectionPage
  last?: string
  orderedItems?: (string | Record<string, unknown>)[]
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

/**
 * Coerces a collection's `orderedItems`/`items` value into an array.
 *
 * JSON-LD compaction collapses a one-element array into the bare value, so a
 * page holding a single item arrives as that item — an embedded object, or a
 * string id ref — rather than a one-element array. Iterating it directly
 * throws on an object and walks a string character by character.
 */
export const toCollectionItems = <T>(
  value: T | T[] | null | undefined
): T[] => {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

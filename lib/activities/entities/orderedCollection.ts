import { ContextEntity } from './base'
import { OrderedCollectionPage } from './orderedCollectionPage'

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

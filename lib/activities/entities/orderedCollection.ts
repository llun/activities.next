import { ContextEntity } from './base'
import { OrderedCollectionPage } from './orderedCollectionPage'

export interface OrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems?: number
  first: string | OrderedCollectionPage
  last?: string
}

import { CollectionPage } from './collectionPage'

export interface Collection {
  id: string
  type: 'Collection'
  first: CollectionPage
}

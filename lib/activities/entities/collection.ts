import { CollectionPage } from './collectionPage'
import { Note } from './note'

export type Collection =
  | {
      id: string
      type: 'Collection'
      first: CollectionPage
    }
  | {
      id: string
      type: 'Collection'
      totalItems: number
      items: Note[]
    }

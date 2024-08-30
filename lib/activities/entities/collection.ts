import { Note } from '@llun/activities.schema'

import { CollectionPage } from './collectionPage'

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

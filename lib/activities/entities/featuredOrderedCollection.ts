import { Note } from '@/lib/types/activitypub'

import { ContextEntity } from './base'

export interface FeaturedOrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems: number
  orderedItems: Note[]
}

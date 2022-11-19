import { ContextEntity } from './base'
import { Note } from './note'

export interface FeaturedOrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems: number
  orderedItems: Note[]
}

import { ContextEntity } from './base'
import { HashTag } from './hashTag'

export interface HashTagCollection extends ContextEntity {
  id: string
  type: 'Collection'
  totalItems: number
  items: HashTag[]
}

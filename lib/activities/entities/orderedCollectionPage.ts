import { AnnounceStatus } from '../actions/announceStatus'
import { CreateStatus } from '../actions/createStatus'
import { ContextEntity } from './base'

export interface OrderedCollectionPage extends ContextEntity {
  id: string
  type: 'OrderedCollectionPage'
  next: string
  prev?: string
  partOf?: string
  orderedItems?: (CreateStatus | AnnounceStatus | string)[]
}

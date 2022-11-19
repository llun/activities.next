import { ContextEntity } from './base'

export interface OrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems: number
  first: string
  last?: string
}

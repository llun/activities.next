import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'

export interface DeleteStatus extends BaseActivity, ContextEntity {
  type: 'Delete'
  to: string[]
  object: {
    id: string
    type: 'Tombstone'
  }
}

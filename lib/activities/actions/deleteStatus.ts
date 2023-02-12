import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'
import { DeleteAction } from './types'

export interface DeleteStatus extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: {
    id: string
    type: 'Tombstone'
  }
}

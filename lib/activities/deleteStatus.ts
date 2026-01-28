import { ContextEntity } from '@/lib/types/activitypub'
import { BaseActivity } from './actionsBase'
import { DeleteAction } from '@/lib/types/activitypub/activities'

export interface DeleteStatus extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: {
    id: string
    type: 'Tombstone'
  }
}

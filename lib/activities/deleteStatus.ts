import { ContextEntity } from '@/lib/types/activitypub'
import { DeleteAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface DeleteStatus extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: {
    id: string
    type: 'Tombstone'
  }
}

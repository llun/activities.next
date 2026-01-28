import { ContextEntity } from '@/lib/types/activitypub'
import { DeleteAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

// TODO: Check on how to differentate delete object
export interface DeleteUser extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: string
}

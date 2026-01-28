import { ContextEntity } from '@/lib/types/activitypub'
import { BaseActivity } from './actionsBase'
import { DeleteAction } from '@/lib/types/activitypub/activities'

// TODO: Check on how to differentate delete object
export interface DeleteUser extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: string
}

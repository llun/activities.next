import { ContextEntity } from '@/lib/types/activitypub'
import { FollowOrObjectRef } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface AcceptFollow extends BaseActivity, ContextEntity {
  type: 'Accept'
  object: FollowOrObjectRef
}

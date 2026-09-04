import { ContextEntity } from '@/lib/types/activitypub'
import { FollowOrObjectRef } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface RejectFollow extends BaseActivity, ContextEntity {
  type: 'Reject'
  object: FollowOrObjectRef
}

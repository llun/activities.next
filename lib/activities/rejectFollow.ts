import { ContextEntity } from '@/lib/types/activitypub'
import { Follow } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface RejectFollow extends BaseActivity, ContextEntity {
  type: 'Reject'
  object: Follow
}

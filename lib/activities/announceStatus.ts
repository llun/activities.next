import { ContextEntity } from '@/lib/types/activitypub'
import { AnnounceAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface AnnounceStatus extends BaseActivity, ContextEntity {
  type: AnnounceAction
  published: string
  to: string[]
  cc: string[]
  object: string
}

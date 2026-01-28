import { ContextEntity } from '@/lib/types/activitypub'
import { Follow } from '@/lib/types/activitypub/activities'
import { UndoAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface UndoFollow extends BaseActivity, ContextEntity {
  type: UndoAction
  object: Follow
}

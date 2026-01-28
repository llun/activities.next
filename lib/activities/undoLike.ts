import { ContextEntity } from '@/lib/types/activitypub'
import { UndoAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'
import { LikeStatus } from './likeAction'

export interface UndoLike extends BaseActivity, ContextEntity {
  type: UndoAction
  object: LikeStatus
}

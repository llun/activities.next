import { ContextEntity } from '@/lib/types/activitypub'
import { BaseActivity } from './actionsBase'
import { LikeStatus } from './likeAction'
import { UndoAction } from '@/lib/types/activitypub/activities'

export interface UndoLike extends BaseActivity, ContextEntity {
  type: UndoAction
  object: LikeStatus
}

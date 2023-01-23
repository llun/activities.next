import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'
import { LikeStatus } from './like'

export interface UndoLike extends BaseActivity, ContextEntity {
  type: 'Undo'
  object: LikeStatus
}

import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'
import { LikeStatus } from './like'
import { UndoAction } from './types'

export interface UndoLike extends BaseActivity, ContextEntity {
  type: UndoAction
  object: LikeStatus
}

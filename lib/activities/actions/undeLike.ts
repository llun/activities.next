import { ContextEntity } from '../entities/base'
import { Like } from '../entities/like'
import { BaseActivity } from './base'

export interface UndoLike extends BaseActivity, ContextEntity {
  type: 'Undo'
  object: Like
}

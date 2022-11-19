import { ContextEntity } from '../entities/base'
import { Follow } from '../entities/follow'
import { BaseActivity } from './base'

export interface UndoFollow extends BaseActivity, ContextEntity {
  type: 'Undo'
  object: Follow
}

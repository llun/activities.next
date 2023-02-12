import { ContextEntity } from '../entities/base'
import { Follow } from '../entities/follow'
import { BaseActivity } from './base'
import { UndoAction } from './types'

export interface UndoFollow extends BaseActivity, ContextEntity {
  type: UndoAction
  object: Follow
}

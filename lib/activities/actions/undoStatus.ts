import { ContextEntity } from '../entities/base'
import { AnnounceStatus } from './announceStatus'
import { BaseActivity } from './base'
import { UndoAction } from './types'

export interface UndoStatus extends BaseActivity, ContextEntity {
  type: UndoAction
  to: string[]
  object: AnnounceStatus
}

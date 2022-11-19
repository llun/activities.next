import { ContextEntity } from '../entities/base'
import { Signature } from '../types'
import { AnnounceStatus } from './announceStatus'
import { BaseActivity } from './base'

export interface UndoStatus extends BaseActivity, ContextEntity {
  type: 'Undo'
  to: string[]
  object: AnnounceStatus
  signature: Signature
}

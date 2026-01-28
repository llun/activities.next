import { ContextEntity } from '@/lib/types/activitypub'
import { AnnounceStatus } from './announceStatus'
import { BaseActivity } from './actionsBase'
import { UndoAction } from '@/lib/types/activitypub/activities'

export interface UndoStatus extends BaseActivity, ContextEntity {
  type: UndoAction
  to: string[]
  object: AnnounceStatus
}

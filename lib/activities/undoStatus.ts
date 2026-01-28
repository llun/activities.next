import { ContextEntity } from '@/lib/types/activitypub'
import { UndoAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'
import { AnnounceStatus } from './announceStatus'

export interface UndoStatus extends BaseActivity, ContextEntity {
  type: UndoAction
  to: string[]
  object: AnnounceStatus
}

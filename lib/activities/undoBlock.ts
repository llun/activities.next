import { ContextEntity } from '@/lib/types/activitypub'
import { Block } from '@/lib/types/activitypub/activities'
import { UndoAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

export interface UndoBlock extends BaseActivity, ContextEntity {
  type: UndoAction
  object: Block
}

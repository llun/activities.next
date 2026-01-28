import { Note, Question } from '@/lib/types/activitypub'
import { ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './actionsBase'

export interface LikeStatus extends BaseActivity, ContextEntity {
  type: 'Like'
  object: string | Note | Question
}

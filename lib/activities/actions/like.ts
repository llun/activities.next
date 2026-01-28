import { Note, Question } from '@/lib/schema'
import { ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './base'

export interface LikeStatus extends BaseActivity, ContextEntity {
  type: 'Like'
  object: string | Note | Question
}

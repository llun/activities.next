import { Note, Question } from '@llun/activities.schema'

import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'

export interface LikeStatus extends BaseActivity, ContextEntity {
  type: 'Like'
  object: string | Note | Question
}

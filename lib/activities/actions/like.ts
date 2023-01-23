import { ContextEntity } from '../entities/base'
import { Note } from '../entities/note'
import { BaseActivity } from './base'

export interface LikeStatus extends BaseActivity, ContextEntity {
  type: 'Like'
  object: string | Note
}

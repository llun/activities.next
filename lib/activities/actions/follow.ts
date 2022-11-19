import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'

export interface FollowRequest extends ContextEntity, BaseActivity {
  type: 'Follow'
  object: string
}

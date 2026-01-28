import { ContextEntity } from '@/lib/types/activitypub'
import { BaseActivity } from './actionsBase'

export interface FollowRequest extends ContextEntity, BaseActivity {
  type: 'Follow'
  object: string
}

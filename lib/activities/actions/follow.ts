import { ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './base'

export interface FollowRequest extends ContextEntity, BaseActivity {
  type: 'Follow'
  object: string
}

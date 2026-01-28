import { ContextEntity } from '@/lib/types/activitypub'
import { Follow } from '@/lib/types/activitypub/activities'
import { BaseActivity } from './actionsBase'

export interface AcceptFollow extends BaseActivity, ContextEntity {
  type: 'Accept'
  object: Follow
}

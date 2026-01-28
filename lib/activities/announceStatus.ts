import { ContextEntity } from '@/lib/types/activitypub'
import { BaseActivity } from './actionsBase'
import { AnnounceAction } from '@/lib/types/activitypub/activities'

export interface AnnounceStatus extends BaseActivity, ContextEntity {
  type: AnnounceAction
  published: string
  to: string[]
  cc: string[]
  object: string
}

import { ContextEntity } from '../entities/base'
import { Follow } from '../entities/follow'
import { BaseActivity } from './base'

export interface RejectFollow extends BaseActivity, ContextEntity {
  type: 'Reject'
  object: Follow
}

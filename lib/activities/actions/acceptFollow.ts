import { ContextEntity } from '../entities/base'
import { Follow } from '../entities/follow'
import { BaseActivity } from './base'

export interface AcceptFollow extends BaseActivity, ContextEntity {
  type: 'Accept'
  object: Follow
}

import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'

export interface AnnounceStatus extends BaseActivity, ContextEntity {
  type: 'Like'
  object: string
}

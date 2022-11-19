import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'

export interface AnnounceStatus extends BaseActivity, ContextEntity {
  type: 'Announce'
  published: string
  to: string[]
  cc: string[]
  object: string
}

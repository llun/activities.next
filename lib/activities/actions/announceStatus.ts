import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'
import { AnnounceAction } from './types'

export interface AnnounceStatus extends BaseActivity, ContextEntity {
  type: AnnounceAction
  published: string
  to: string[]
  cc: string[]
  object: string
}

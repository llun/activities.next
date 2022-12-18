import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'

// TODO: Check on how to differentate delete object
export interface DeleteUser extends BaseActivity, ContextEntity {
  type: 'Delete'
  to: string[]
  object: string
}

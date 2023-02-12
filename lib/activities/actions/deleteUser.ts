import { ContextEntity } from '../entities/base'
import { BaseActivity } from './base'
import { DeleteAction } from './types'

// TODO: Check on how to differentate delete object
export interface DeleteUser extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: string
}

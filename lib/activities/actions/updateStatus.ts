import { ContextEntity } from '../entities/base'
import { Note } from '../entities/note'
import { Question } from '../entities/question'
import { Signature } from '../types'
import { BaseActivity } from './base'
import { UpdateAction } from './types'

export interface UpdateStatus extends BaseActivity, ContextEntity {
  type: UpdateAction
  to: string[]
  object: Note | Question
  signature: Signature
}

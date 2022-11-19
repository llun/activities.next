import { ContextEntity } from '../entities/base'
import { Note } from '../entities/note'
import { Question } from '../entities/question'
import { Signature } from '../types'
import { BaseActivity } from './base'

export interface UpdateStatus extends BaseActivity, ContextEntity {
  type: 'Update'
  to: string[]
  object: Note | Question
  signature: Signature
}

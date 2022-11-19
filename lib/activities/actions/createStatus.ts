import { ContextEntity } from '../entities/base'
import { Note } from '../entities/note'
import { Question } from '../entities/question'
import { Signature } from '../types'
import { BaseActivity } from './base'

export interface CreateStatus extends BaseActivity, ContextEntity {
  type: 'Create'
  published: string
  to: string[]
  cc: string[]
  object: Note | Question
  signature?: Signature
}

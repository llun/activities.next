import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@llun/activities.schema'

import { ContextEntity } from '../entities/base'
import { Signature } from '../types'
import { BaseActivity } from './base'
import { UpdateAction } from './types'

export interface UpdateStatus extends BaseActivity, ContextEntity {
  type: UpdateAction
  published: string
  to: string | string[]
  cc: string | string[]
  object:
    | Note
    | Question
    | ImageContent
    | PageContent
    | ArticleContent
    | VideoContent
  signature?: Signature
}

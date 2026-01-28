import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@/lib/schema'
import { ContextEntity, Signature } from '@/lib/types/activitypub'

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

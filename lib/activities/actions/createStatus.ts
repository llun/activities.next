import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@llun/activities.schema'

import { BaseActivity } from '@/lib/activities/actions/base'
import { CreateAction } from '@/lib/activities/actions/types'
import { ContextEntity } from '@/lib/activities/entities/base'
import { Signature } from '@/lib/activities/types'

export interface CreateStatus extends BaseActivity, ContextEntity {
  type: CreateAction
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

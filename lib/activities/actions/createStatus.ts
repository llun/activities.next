import { BaseActivity } from '@/lib/activities/actions/base'
import { CreateAction } from '@/lib/activities/actions/types'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@/lib/schema'
import { ContextEntity, Signature } from '@/lib/types/activitypub'

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

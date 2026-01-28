import { BaseActivity } from '@/lib/activities/actionsBase'
import { ContextEntity } from '@/lib/types/activitypub'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@/lib/types/activitypub'
import { CreateAction } from '@/lib/types/activitypub/activities'
import { Signature } from '@/lib/types/activitypub/webfinger'

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

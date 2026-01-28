import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@/lib/types/activitypub'

import { ContextEntity } from '@/lib/types/activitypub'
import { Signature } from '@/lib/types/activitypub/webfinger'
import { BaseActivity } from './actionsBase'
import { UpdateAction } from '@/lib/types/activitypub/activities'

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

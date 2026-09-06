import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  Question,
  VideoContent
} from '@/lib/types/activitypub'
import { ContextEntity } from '@/lib/types/activitypub'
import { UpdateAction } from '@/lib/types/activitypub/activities'
import { Signature } from '@/lib/types/activitypub/webfinger'

import { BaseActivity } from './actionsBase'

export interface UpdateStatus extends BaseActivity, ContextEntity {
  type: UpdateAction
  published: string
  to?: string | string[] | null
  cc?: string | string[] | null
  object:
    Note | Question | ImageContent | PageContent | ArticleContent | VideoContent
  signature?: Signature
}

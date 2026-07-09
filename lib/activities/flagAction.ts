import { ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './actionsBase'

// Mastodon Flag activity: forwarded to a reported actor's origin so the remote
// instance can review the report. `object` carries the reported actor and any
// reported status URIs; `content` is the reporter's comment.
export interface FlagRequest extends ContextEntity, BaseActivity {
  type: 'Flag'
  content: string
  object: string | string[]
}

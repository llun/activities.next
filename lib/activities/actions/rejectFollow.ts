import { z } from 'zod'

import { APFollow, ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './base'

// Use the inferred type from APFollow
type Follow = z.infer<typeof APFollow>

export interface RejectFollow extends BaseActivity, ContextEntity {
  type: 'Reject'
  object: Follow
}

import { z } from 'zod'

import { APFollow, ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './base'

// Use the inferred type from APFollow
type Follow = z.infer<typeof APFollow>

export interface AcceptFollow extends BaseActivity, ContextEntity {
  type: 'Accept'
  object: Follow
}

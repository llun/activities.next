import { z } from 'zod'

import { APFollow, ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './base'
import { UndoAction } from './types'

// Use the inferred type from APFollow
type Follow = z.infer<typeof APFollow>

export interface UndoFollow extends BaseActivity, ContextEntity {
  type: UndoAction
  object: Follow
}

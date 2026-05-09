import { ContextEntity } from '@/lib/types/activitypub'

import { BaseActivity } from './actionsBase'

export interface BlockRequest extends ContextEntity, BaseActivity {
  type: 'Block'
  object: string
}

import { ContextEntity } from '@/lib/types/activitypub'
import { DeleteAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

// A Delete activity whose `object` is a bare actor IRI string is an account
// deletion (vs. DeleteStatus, whose `object` is a `{ id, type: 'Tombstone' }`).
// `deleteObjectJob` differentiates the two at handling time: a string object is
// routed to `deleteActor`, a Tombstone object to `deleteStatus`.
export interface DeleteUser extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: string
}

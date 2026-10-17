import { ContextEntity } from '@/lib/types/activitypub'
import { DeleteAction } from '@/lib/types/activitypub/activities'

import { BaseActivity } from './actionsBase'

// A Delete activity whose `object` is a bare actor IRI string is usually an
// account deletion (vs. DeleteStatus, whose `object` is a `{ id, type:
// 'Tombstone' }`). `deleteObjectJob` does not decide by shape: like Mastodon it
// takes the id of a string or of any embedded object (a Tombstone included),
// deletes that account when the id is the verified sender, and otherwise
// deletes the stored status with that id, scoped to the verified sender.
export interface DeleteUser extends BaseActivity, ContextEntity {
  type: DeleteAction
  to: string[]
  object: string
}

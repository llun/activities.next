import { AnnounceStatus } from './announceStatus'
import { CreateStatus } from './createStatus'
import { DeleteStatus } from './deleteStatus'
import { DeleteUser } from './deleteUser'
import { UndoStatus } from './undoStatus'
import { UpdateStatus } from './updateStatus'

export type StatusActivity =
  | CreateStatus
  | UpdateStatus
  | DeleteStatus
  | DeleteUser
  | AnnounceStatus
  | UndoStatus

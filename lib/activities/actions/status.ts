import { AnnounceStatus } from './announceStatus'
import { CreateStatus } from './createStatus'
import { UndoStatus } from './undoStatus'
import { UpdateStatus } from './updateStatus'

export type StatusActivity =
  | CreateStatus
  | AnnounceStatus
  | UpdateStatus
  | UndoStatus

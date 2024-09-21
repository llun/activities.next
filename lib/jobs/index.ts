import { JobHandle } from '../services/queue/type'
import { createAnnounceJob } from './createAnnounceJob'
import { createNoteJob } from './createNoteJob'
import { createPollJob } from './createPollJob'
import { deleteObjectJob } from './deleteObjectJob'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  DELETE_OBJECT_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from './names'
import { updateNoteJob } from './updateNoteJob'
import { updatePollJob } from './updatePollJob'

export const JOBS: Record<string, JobHandle> = {
  [CREATE_NOTE_JOB_NAME]: createNoteJob,
  [UPDATE_NOTE_JOB_NAME]: updateNoteJob,
  [CREATE_ANNOUNCE_JOB_NAME]: createAnnounceJob,
  [CREATE_POLL_JOB_NAME]: createPollJob,
  [UPDATE_POLL_JOB_NAME]: updatePollJob,
  [DELETE_OBJECT_JOB_NAME]: deleteObjectJob
}

import { JobHandle } from '../services/queue/type'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  createAnnounceJob
} from './createAnnounceJob'
import { CREATE_NOTE_JOB_NAME, createNoteJob } from './createNoteJob'
import { CREATE_POLL_JOB_NAME, createPollJob } from './createPollJob'
import { UPDATE_POLL_JOB_NAME, updatePollJob } from './updatePollJob'

export const JOBS: Record<string, JobHandle> = {
  [CREATE_NOTE_JOB_NAME]: createNoteJob,
  [CREATE_ANNOUNCE_JOB_NAME]: createAnnounceJob,
  [CREATE_POLL_JOB_NAME]: createPollJob,
  [UPDATE_POLL_JOB_NAME]: updatePollJob
}

import { JobHandle } from '../services/queue/type'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  createAnnounceJob
} from './createAnnounceJob'
import { CREATE_NOTE_JOB_NAME, createNoteJob } from './createNoteJob'

export const JOBS: Record<string, JobHandle> = {
  [CREATE_NOTE_JOB_NAME]: createNoteJob,
  [CREATE_ANNOUNCE_JOB_NAME]: createAnnounceJob
}

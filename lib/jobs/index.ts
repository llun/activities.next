import { z } from 'zod'

import { JobHandle } from '../services/queue/type'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CreateAnnounceJobMessage,
  createAnnounceJob
} from './createAnnounceJob'
import {
  CREATE_NOTE_JOB_NAME,
  CreateNoteJobMessage,
  createNoteJob
} from './createNoteJob'

export const JOBS: Record<string, JobHandle> = {
  [CREATE_NOTE_JOB_NAME]: createNoteJob,
  [CREATE_ANNOUNCE_JOB_NAME]: createAnnounceJob
}

export const JobMessage = z.union([
  CreateNoteJobMessage,
  CreateAnnounceJobMessage
])
export type JobMessage = z.infer<typeof JobMessage>

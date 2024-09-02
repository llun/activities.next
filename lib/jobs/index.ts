import { CREATE_NOTE_JOB_NAME } from '../actions/createNote'
import { createNoteJob } from './createNoteJob'

export const JOBS = {
  [CREATE_NOTE_JOB_NAME]: createNoteJob
}

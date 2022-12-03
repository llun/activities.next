import { Note } from '../activities/entities/note'

interface CreateNoteParams {
  note: Note
  storage: Storage
}
export const createNote = async ({ note, storage }: CreateNoteParams) => {
  console.log('Create Note')
}

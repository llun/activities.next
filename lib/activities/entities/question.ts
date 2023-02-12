import { BaseNote, NoteEntity } from './note'

export const QuestionEntity = 'Question'
export type QuestionEntity = typeof QuestionEntity

export interface QuestionNote {
  type: NoteEntity
  name: string
  replies: { type: 'Collection'; totalItems: number }
}

export interface Question extends BaseNote {
  type: QuestionEntity
  endTime: string
  oneOf: QuestionNote[]
}

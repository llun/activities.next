import { BaseNote } from './note'

export interface QuestionNote {
  type: 'Note'
  name: string
  replies: { type: 'Collection'; totalItems: number }
}

export interface Question extends BaseNote {
  type: 'Question'
  endTime: string
  oneOf: QuestionNote[]
}

export interface QuestionChoiceData {
  statusId: string
  text: string
  totalVote: number

  createdAt: number
  updatedAt: number
}

export class QuestionChoice {
  readonly data: QuestionChoiceData

  constructor(data: QuestionChoiceData) {
    this.data = data
  }

  get statusId() {
    return this.data.statusId
  }

  get text() {
    return this.data.text
  }

  get totalVote() {
    return this.data.totalVote
  }
}

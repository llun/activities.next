export interface PollChoiceData {
  statusId: string
  text: string
  totalVote: number

  createdAt: number
  updatedAt: number
}

export class PollChoice {
  readonly data: PollChoiceData

  constructor(data: PollChoiceData) {
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

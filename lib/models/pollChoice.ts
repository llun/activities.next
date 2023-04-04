export interface PollChoiceData {
  statusId: string
  title: string
  totalVotes: number

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

  get title() {
    return this.data.title
  }

  get totalVotes() {
    return this.data.totalVotes
  }

  toJson() {
    return this.data
  }
}

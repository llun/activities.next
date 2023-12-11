import { z } from 'zod'

export const PollChoiceData = z.object({
  statusId: z.string(),
  title: z.string(),
  totalVotes: z.number(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type PollChoiceData = z.infer<typeof PollChoiceData>

export class PollChoice {
  readonly data: PollChoiceData

  constructor(data: PollChoiceData) {
    this.data = PollChoiceData.parse(data)
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

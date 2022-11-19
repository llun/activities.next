import { Question as EntityQuestion } from '../activities/entities/question'

export interface Question {
  statusId: string

  options: string

  votersCount: number

  endAt: number
  createdAt: number
  updatedAt?: number
}

export const fromJson = (data: EntityQuestion): Question => ({
  statusId: data.id,
  endAt: new Date(data.endTime).getTime(),
  votersCount: data.votersCount,
  options: JSON.stringify(data.oneOf),
  createdAt: new Date(data.published).getTime()
})

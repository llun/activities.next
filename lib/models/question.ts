import { Question as EntityQuestion } from '../activities/entities/question'

export interface Question {
  statusId: string

  options: string

  endAt: number
  createdAt: number
  updatedAt?: number
}

export const fromJson = (data: EntityQuestion): Question => ({
  statusId: data.id,
  endAt: new Date(data.endTime).getTime(),
  options: JSON.stringify(data.oneOf),
  createdAt: new Date(data.published).getTime()
})

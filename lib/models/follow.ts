import { Actor } from './actor'

export interface Follow {
  id: string
  actor: Actor

  targetActorId: string
  status: 'Requested' | 'Accepted'

  createdAt: number
  updatedAt: number
}

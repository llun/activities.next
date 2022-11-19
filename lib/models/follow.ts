export interface Follow {
  id: string
  actorId: string
  actorHost: string

  targetActorId: string
  targetActorHost: string

  status: 'Requested' | 'Accepted' | 'Undo' | 'Rejected'

  createdAt: number
  updatedAt: number
}

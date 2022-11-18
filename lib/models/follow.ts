export interface Follow {
  id: string
  actorId: string
  targetActorId: string
  status: 'Requested' | 'Accepted'

  createdAt: number
  updatedAt: number
}

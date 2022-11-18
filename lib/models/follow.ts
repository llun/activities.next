export interface Follow {
  id: string
  actorId: string
  targetActorId: string
  status: 'Requested' | 'Accepted' | 'Undo' | 'Rejected'

  createdAt: number
  updatedAt: number
}

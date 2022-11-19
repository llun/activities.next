export enum FollowStatus {
  Requested = 'Requested',
  Accepted = 'Accepted',
  Undo = 'Undo',
  Rejected = 'Rejected'
}

export interface Follow {
  id: string
  actorId: string
  actorHost: string

  targetActorId: string
  targetActorHost: string

  status: FollowStatus

  createdAt: number
  updatedAt: number
}

// Follow entity type for actions
// This is a simple type used by action definitions

export interface Follow {
  id: string
  type: 'Follow'
  actor: string
  object: string
}

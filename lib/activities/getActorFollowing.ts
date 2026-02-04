import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'

import { getActorCollections } from './getActorCollections'

type GetActorFollowingFunction = (params: {
  person: Actor
  signingActor?: DomainActor
}) => Promise<{ followingCount: number; following: string[] }>

export const getActorFollowing: GetActorFollowingFunction = async ({
  person,
  signingActor
}) => {
  const value = await getActorCollections({
    person,
    field: 'following',
    signingActor
  })
  return {
    followingCount: value?.totalItems ?? 0,
    following: (value?.page?.orderedItems as string[]) ?? []
  }
}

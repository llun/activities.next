import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'

import { getActorCollections } from './getActorCollections'

type GetActorFollowersFunction = (params: {
  person: Actor
  signingActor?: DomainActor
}) => Promise<{ followerCount: number; followers: string[] }>

export const getActorFollowers: GetActorFollowersFunction = async ({
  person,
  signingActor
}) => {
  const value = await getActorCollections({
    person,
    field: 'followers',
    signingActor
  })
  return {
    followerCount: value?.totalItems ?? 0,
    followers: (value?.page?.orderedItems as string[]) ?? []
  }
}

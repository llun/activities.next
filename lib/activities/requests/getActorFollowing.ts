import { Actor } from '@llun/activities.schema'

import { getActorCollections } from './getActorCollections'

type GetActorFollowingFunction = (params: {
  person: Actor
}) => Promise<{ followingCount: number; following: string[] }>

export const getActorFollowing: GetActorFollowingFunction = async ({
  person
}) => {
  const value = await getActorCollections({
    person,
    field: 'following'
  })
  return {
    followingCount: value?.totalItems ?? 0,
    following: (value?.page?.orderedItems as string[]) ?? []
  }
}

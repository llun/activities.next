import { Actor } from '@llun/activities.schema'

import { getActorCollections } from './getActorCollections'

type GetActorFollowersFunction = (params: {
  person: Actor
}) => Promise<{ followerCount: number; followers: string[] }>

export const getActorFollowers: GetActorFollowersFunction = async ({
  person
}) => {
  const value = await getActorCollections({
    person,
    field: 'followers'
  })
  return {
    followerCount: value?.totalItems ?? 0,
    followers: (value?.page?.orderedItems as string[]) ?? []
  }
}

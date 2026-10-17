interface LocalActorIdParams {
  domain: string
  username: string
}

interface LocalStatusIdParams {
  actorId: string
  statusId: string
}

export const getLocalActorId = ({ domain, username }: LocalActorIdParams) =>
  `https://${domain}/users/${username}`

export const getLocalActorFollowersId = (actorId: string) =>
  `${actorId}/followers`

export const getLocalActorInboxId = (actorId: string) => `${actorId}/inbox`

export const getLocalActorOutboxId = (actorId: string) => `${actorId}/outbox`

export const getLocalActorFeaturedCollectionId = (actorId: string) =>
  `${actorId}/collections/featured`

export const getLocalActorFeaturedTagsCollectionId = (actorId: string) =>
  `${actorId}/collections/tags`

export const getLocalActorSharedInboxId = (domain: string) =>
  `https://${domain}/inbox`

export const getLocalStatusId = ({ actorId, statusId }: LocalStatusIdParams) =>
  `${actorId}/statuses/${statusId}`

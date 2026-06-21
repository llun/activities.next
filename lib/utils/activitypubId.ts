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

// FEP-7aa9: the actor's collection of public FeaturedCollection objects, and the
// id of an individual FeaturedCollection (a curated set of accounts).
export const getLocalActorFeaturedCollectionsId = (actorId: string) =>
  `${actorId}/collections/featured-collections`

export const getLocalFeaturedCollectionId = (
  actorId: string,
  collectionId: string
) => `${actorId}/collections/featured-collections/${collectionId}`

export const getLocalActorSharedInboxId = (domain: string) =>
  `https://${domain}/inbox`

export const getLocalStatusId = ({ actorId, statusId }: LocalStatusIdParams) =>
  `${actorId}/statuses/${statusId}`

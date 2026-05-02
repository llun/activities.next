import {
  getLocalActorFeaturedCollectionId,
  getLocalActorFeaturedTagsCollectionId,
  getLocalActorFollowersId,
  getLocalActorId,
  getLocalActorInboxId,
  getLocalActorOutboxId,
  getLocalActorSharedInboxId,
  getLocalStatusId
} from '@/lib/utils/activitypubId'

describe('activitypubId helpers', () => {
  it('builds stable local actor and collection IDs from one canonical format', () => {
    const actorId = getLocalActorId({
      domain: 'example.com',
      username: 'alice'
    })

    expect(actorId).toBe('https://example.com/users/alice')
    expect(getLocalActorFollowersId(actorId)).toBe(
      'https://example.com/users/alice/followers'
    )
    expect(getLocalActorInboxId(actorId)).toBe(
      'https://example.com/users/alice/inbox'
    )
    expect(getLocalActorOutboxId(actorId)).toBe(
      'https://example.com/users/alice/outbox'
    )
    expect(getLocalActorFeaturedCollectionId(actorId)).toBe(
      'https://example.com/users/alice/collections/featured'
    )
    expect(getLocalActorFeaturedTagsCollectionId(actorId)).toBe(
      'https://example.com/users/alice/collections/tags'
    )
    expect(getLocalActorSharedInboxId('example.com')).toBe(
      'https://example.com/inbox'
    )
    expect(getLocalStatusId({ actorId, statusId: 'post-1' })).toBe(
      'https://example.com/users/alice/statuses/post-1'
    )
  })
})

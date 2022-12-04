import { FollowStatus } from '../models/follow'
import { MockActor } from '../stub/actor'
import { createFollower } from './createFollower'

// TODO: Replace this mock storage with in memory database? and test seed data
const mockStorage = {
  createFollow: jest.fn(),
  getActorFromId: jest.fn()
} as any

describe('#createFollower', () => {
  it('creates follower in database and send accept follow back', async () => {
    const targetActor = MockActor({ id: 'https://llun.test/users/null ' })
    const actor = MockActor({ id: 'https://another.network/users/friend' })
    const follow = await createFollower({
      storage: mockStorage,
      targetActorId: targetActor.id,
      actorId: actor.id
    })
    expect(mockStorage.createFollow).toHaveBeenCalledWith({
      actorId: actor.id,
      targetActorId: targetActor.id,
      status: FollowStatus.Accepted
    })
    expect(follow).toEqual({
      id: expect.toBeString(),
      type: 'Follow',
      actor: actor.id,
      object: targetActor.id
    })
  })
})

import crypto from 'crypto'

import { acceptFollow } from '../activities'
import { FollowStatus } from '../models/follow'
import { MockActor } from '../stub/actor'
import { MockFollowRequest } from '../stub/followRequest'
import { createFollower } from './createFollower'

const actor = MockActor({ id: 'https://llun.test/users/null' })

// TODO: Replace this mock storage with in memory database? and test seed data
const mockStorage = {
  createFollow: jest.fn(async ({ actorId, targetActorId, stats }) => {
    return {
      id: crypto.randomUUID(),
      type: 'Follow',
      actor: actorId,
      object: targetActorId
    }
  }),
  getActorFromId: jest.fn(async ({ id }) => {
    if (id === 'https://llun.test/users/null') {
      return actor
    }
    return null
  })
} as any

jest.mock('../activities', () => ({
  acceptFollow: jest.fn()
}))

describe('#createFollower', () => {
  it('creates follower in database and send accept follow back', async () => {
    const request = MockFollowRequest({
      actorId: 'https://another.network/users/friend',
      targetActorId: 'https://llun.test/users/null'
    })
    const follow = await createFollower({
      storage: mockStorage,
      followRequest: request
    })
    expect(mockStorage.createFollow).toHaveBeenCalledWith({
      actorId: 'https://another.network/users/friend',
      targetActorId: actor.id,
      status: FollowStatus.Accepted
    })
    expect(follow).toEqual({
      id: expect.toBeString(),
      type: 'Follow',
      actor: 'https://another.network/users/friend',
      object: actor.id
    })
    expect(acceptFollow).toHaveBeenCalledWith(actor, request)
  })

  it(`returns null and don't do anything`, async () => {
    const request = MockFollowRequest({
      actorId: 'https://another.network/users/friend',
      targetActorId: 'https://llun.test/users/notexist'
    })
    const follow = await createFollower({
      storage: mockStorage,
      followRequest: request
    })
    expect(follow).toBeNull()
  })
})

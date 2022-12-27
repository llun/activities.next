import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { FollowStatus } from '../models/follow'
import { Status } from '../models/status'
import { Storage } from '../storage/types'
import { seedActor1 } from './seed/actor1'
import { seedActor2 } from './seed/actor2'

export const seedStorage = async (storage: Storage) => {
  await storage.createAccount(seedActor1)
  await storage.createAccount(seedActor2)

  const actor1 = await storage.getActorFromEmail({ email: seedActor1.email })
  const actor2 = await storage.getActorFromEmail({ email: seedActor2.email })
  if (!actor1 || !actor2) return

  // Actor1 following
  await storage.createFollow({
    actorId: actor1.id,
    targetActorId: 'https://llun.dev/users/test1',
    inbox: `${actor1.id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Accepted
  })
  await storage.createFollow({
    actorId: actor1.id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actor1.id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Accepted
  })

  // Actor2 following
  await storage.createFollow({
    actorId: actor2.id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actor2.id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Accepted
  })
  // Actor2 followers
  await storage.createFollow({
    actorId: 'https://llun.dev/users/test1',
    targetActorId: actor2.id,
    inbox: 'https://llun.dev/users/test1',
    sharedInbox: 'https://llun.dev/inbox',
    status: FollowStatus.Accepted
  })

  // Actor1 status
  await storage.createStatus({
    id: `${actor1.id}/statuses/post-1`,
    url: `${actor1.id}/statuses/post-1`,
    actorId: actor1.id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post',
    type: 'Note'
  })

  // Actor2 status
  const post2 = await storage.createStatus({
    id: `${actor2.id}/statuses/post-2`,
    url: `${actor2.id}/statuses/post-2`,
    actorId: actor2.id,
    to: [ACTIVITY_STREAM_PUBLIC, actor1.id],
    cc: [`${actor2.id}/followers`],
    text: Status.linkfyText('@test1@llun.test This is Actor1 post'),
    type: 'Note',
    reply: `${actor1.id}/statuses/post-1`
  })
  await storage.createTag({
    statusId: post2.data.id,
    name: '@test',
    value: 'https://llun.test/@test1'
  })
}

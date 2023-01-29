import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { linkifyText } from '../link'
import { Actor } from '../models/actor'
import { FollowStatus } from '../models/follow'
import { Storage } from '../storage/types'
import { seedActor1 } from './seed/actor1'
import { seedActor2 } from './seed/actor2'
import { seedActor3 } from './seed/actor3'

export const seedStorage = async (storage: Storage) => {
  await Promise.all([
    storage.createAccount(seedActor1),
    storage.createAccount(seedActor2),
    storage.createAccount(seedActor3)
  ])

  const actors = (await Promise.all([
    storage.getActorFromEmail({ email: seedActor1.email }),
    storage.getActorFromEmail({ email: seedActor2.email }),
    storage.getActorFromEmail({ email: seedActor3.email })
  ])) as Actor[]

  if (actors.some((actor) => !actor)) return

  // Actor1 following
  await storage.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://llun.dev/users/test1',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Accepted
  })
  await storage.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Accepted
  })
  await storage.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://somewhere.test/actors/request-following',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Requested
  })

  // Actor1 followers
  await storage.createFollow({
    actorId: 'https://somewhere.test/actors/friend',
    targetActorId: actors[0].id,
    inbox: 'https://somewhere.test/inbox/friend',
    sharedInbox: 'https://somewhere.test/inbox',
    status: FollowStatus.Accepted
  })

  // Actor2 following
  await storage.createFollow({
    actorId: actors[1].id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actors[1].id}/indbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.Accepted
  })
  // Actor2 followers
  await storage.createFollow({
    actorId: 'https://llun.dev/users/test1',
    targetActorId: actors[1].id,
    inbox: 'https://llun.dev/users/test1',
    sharedInbox: 'https://llun.dev/inbox',
    status: FollowStatus.Accepted
  })

  // Actor1 status
  await storage.createNote({
    id: `${actors[0].id}/statuses/post-1`,
    url: `${actors[0].id}/statuses/post-1`,
    actorId: actors[0].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post'
  })

  // Actor2 status
  const post2 = await storage.createNote({
    id: `${actors[1].id}/statuses/post-2`,
    url: `${actors[1].id}/statuses/post-2`,
    actorId: actors[1].id,
    to: [ACTIVITY_STREAM_PUBLIC, actors[0].id],
    cc: [`${actors[1].id}/followers`],
    text: await linkifyText('@test1@llun.test This is Actor1 post', true),
    reply: `${actors[0].id}/statuses/post-1`
  })
  await storage.createTag({
    statusId: post2.data.id,
    name: '@test',
    value: 'https://llun.test/@test1'
  })

  // Actor2 announce
  await storage.createAnnounce({
    id: `${actors[1].id}/statuses/post-3`,
    actorId: actors[1].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${actors[1].id}/followers`],
    originalStatusId: `${actors[1].id}/statuses/post-2`
  })
}

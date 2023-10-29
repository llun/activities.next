import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { FollowStatus } from '../models/follow'
import { Storage } from '../storage/types'
import { linkifyText } from '../text/linkifyText'
import { seedActor1 } from './seed/actor1'
import { seedActor2 } from './seed/actor2'
import { seedActor3 } from './seed/actor3'
import { seedActor4 } from './seed/actor4'
import { seedActor5 } from './seed/actor5'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_INBOX,
  seedExternal1
} from './seed/external1'

export const TEST_SHARED_INBOX = 'https://llun.test/inbox'

export const seedStorage = async (storage: Storage) => {
  await Promise.all([
    storage.createAccount(seedActor1),
    storage.createAccount(seedActor2),
    storage.createAccount(seedActor3),
    storage.createAccount(seedActor4),
    storage.createAccount(seedActor5)
  ])

  const actors = (await Promise.all([
    storage.getActorFromEmail({ email: seedActor1.email }),
    storage.getActorFromEmail({ email: seedActor2.email }),
    storage.getActorFromEmail({ email: seedActor3.email }),
    storage.getActorFromEmail({ email: seedActor4.email }),
    storage.getActorFromEmail({ email: seedActor5.email })
  ])) as Actor[]

  if (actors.some((actor) => !actor)) return

  // External Actors
  await storage.createActor(seedExternal1)

  // Actor1 following
  await storage.createFollow({
    actorId: actors[0].id,
    targetActorId: EXTERNAL_ACTOR1,
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.Accepted
  })
  await storage.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.Accepted
  })
  await storage.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://somewhere.test/actors/request-following',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
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
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.Accepted
  })
  // Actor2 followers
  await storage.createFollow({
    actorId: EXTERNAL_ACTOR1,
    targetActorId: actors[1].id,
    inbox: EXTERNAL_ACTOR1_INBOX,
    sharedInbox: EXTERNAL_ACTOR1_INBOX,
    status: FollowStatus.Accepted
  })

  // Actor3 follows Actor2
  await storage.createFollow({
    actorId: actors[2].id,
    targetActorId: actors[1].id,
    inbox: `${actors[2]}/inbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.Accepted
  })

  // Actor3 follows Actor4
  await storage.createFollow({
    actorId: actors[2].id,
    targetActorId: actors[3].id,
    inbox: `${actors[2]}/inbox`,
    sharedInbox: TEST_SHARED_INBOX,
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

  await storage.createNote({
    id: `${actors[0].id}/statuses/post-2`,
    url: `${actors[0].id}/statuses/post-2`,
    actorId: actors[0].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post 2'
  })

  await storage.createNote({
    id: `${actors[0].id}/statuses/post-3`,
    url: `${actors[0].id}/statuses/post-3`,
    actorId: actors[0].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post 3'
  })

  // Actor2 status
  const post2 = await storage.createNote({
    id: `${actors[1].id}/statuses/post-2`,
    url: `${actors[1].id}/statuses/post-2`,
    actorId: actors[1].id,
    to: [ACTIVITY_STREAM_PUBLIC, actors[0].id],
    cc: [`${actors[1].id}/followers`],
    text: linkifyText('@test1@llun.test This is Actor1 post'),
    reply: `${actors[0].id}/statuses/post-1`
  })
  await storage.createTag({
    statusId: post2.data.id,
    name: '@test',
    value: 'https://llun.test/@test1',
    type: 'mention'
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

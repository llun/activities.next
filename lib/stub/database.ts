import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { FollowStatus } from '@/lib/models/follow'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { seedActor4 } from '@/lib/stub/seed/actor4'
import { seedActor5 } from '@/lib/stub/seed/actor5'
import { seedActor6 } from '@/lib/stub/seed/actor6'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_INBOX,
  seedExternal1
} from './seed/external1'

export const TEST_SHARED_INBOX = 'https://llun.test/inbox'

export const seedDatabase = async (database: Database) => {
  await Promise.all([
    database.createAccount(seedActor1),
    database.createAccount(seedActor2),
    database.createAccount(seedActor3),
    database.createAccount(seedActor4),
    database.createAccount(seedActor5),
    database.createAccount(seedActor6)
  ])

  const actors = (await Promise.all([
    database.getActorFromEmail({ email: seedActor1.email }),
    database.getActorFromEmail({ email: seedActor2.email }),
    database.getActorFromEmail({ email: seedActor3.email }),
    database.getActorFromEmail({ email: seedActor4.email }),
    database.getActorFromEmail({ email: seedActor5.email }),
    database.getActorFromEmail({ email: seedActor6.email })
  ])) as Actor[]

  if (actors.some((actor) => !actor)) return

  // External Actors
  await database.createActor(seedExternal1)

  // Actor1 following
  await database.createFollow({
    actorId: actors[0].id,
    targetActorId: EXTERNAL_ACTOR1,
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Accepted
  })
  await database.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Accepted
  })
  await database.createFollow({
    actorId: actors[0].id,
    targetActorId: 'https://somewhere.test/actors/request-following',
    inbox: `${actors[0].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Requested
  })

  // Actor1 followers
  await database.createFollow({
    actorId: 'https://somewhere.test/actors/friend',
    targetActorId: actors[0].id,
    inbox: 'https://somewhere.test/inbox/friend',
    sharedInbox: 'https://somewhere.test/inbox',
    status: FollowStatus.enum.Accepted
  })

  // Actor5 requests to follow Actor1
  await database.createFollow({
    actorId: actors[4].id,
    targetActorId: actors[0].id,
    inbox: `${actors[4].id}/inbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Requested
  })

  // Actor2 following
  await database.createFollow({
    actorId: actors[1].id,
    targetActorId: 'https://llun.dev/users/test2',
    inbox: `${actors[1].id}/indbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Accepted
  })
  // Actor2 followers
  await database.createFollow({
    actorId: EXTERNAL_ACTOR1,
    targetActorId: actors[1].id,
    inbox: EXTERNAL_ACTOR1_INBOX,
    sharedInbox: EXTERNAL_ACTOR1_INBOX,
    status: FollowStatus.enum.Accepted
  })

  // Actor3 follows Actor2
  await database.createFollow({
    actorId: actors[2].id,
    targetActorId: actors[1].id,
    inbox: `${actors[2].id}/inbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Accepted
  })

  // Actor3 follows Actor4
  await database.createFollow({
    actorId: actors[2].id,
    targetActorId: actors[3].id,
    inbox: `${actors[2].id}/inbox`,
    sharedInbox: TEST_SHARED_INBOX,
    status: FollowStatus.enum.Accepted
  })

  // Actor1 status
  await database.createNote({
    id: `${actors[0].id}/statuses/post-1`,
    url: `${actors[0].id}/statuses/post-1`,
    actorId: actors[0].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post'
  })

  await database.createNote({
    id: `${actors[0].id}/statuses/post-2`,
    url: `${actors[0].id}/statuses/post-2`,
    actorId: actors[0].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post 2'
  })

  // Actor1 post with attachments
  await database.createNote({
    id: `${actors[0].id}/statuses/post-3`,
    url: `${actors[0].id}/statuses/post-3`,
    actorId: actors[0].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'This is Actor1 post 3'
  })
  await database.createAttachment({
    actorId: actors[0].id,
    statusId: `${actors[0].id}/statuses/post-3`,
    mediaType: 'image/png',
    url: 'https://via.placeholder.com/150',
    width: 150,
    height: 150
  })
  await database.createAttachment({
    actorId: actors[0].id,
    statusId: `${actors[0].id}/statuses/post-3`,
    mediaType: 'image/png',
    url: 'https://via.placeholder.com/150',
    width: 150,
    height: 150
  })

  // Actor2 status
  const post2 = await database.createNote({
    id: `${actors[1].id}/statuses/post-2`,
    url: `${actors[1].id}/statuses/post-2`,
    actorId: actors[1].id,
    to: [ACTIVITY_STREAM_PUBLIC, actors[0].id],
    cc: [`${actors[1].id}/followers`],
    text: convertMarkdownText(TEST_DOMAIN)(
      '@test1@llun.test This is Actor1 post'
    ),
    reply: `${actors[0].id}/statuses/post-1`
  })
  await database.createTag({
    statusId: post2.data.id,
    name: '@test1',
    value: 'https://llun.test/@test1',
    type: 'mention'
  })

  // Actor2 announce
  await database.createAnnounce({
    id: `${actors[1].id}/statuses/post-3`,
    actorId: actors[1].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${actors[1].id}/followers`],
    originalStatusId: `${actors[1].id}/statuses/post-2`
  })

  // Actor 3 poll
  await database.createPoll({
    id: `${actors[2].id}/statuses/poll-1`,
    actorId: actors[2].id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    url: `${actors[2].id}/statuses/poll-1`,
    text: 'This is a poll',
    choices: ['Yes', 'No'],
    endAt: Date.now() + 1000
  })

  await database.createLike({
    actorId: actors[1].id,
    statusId: `${actors[2].id}/statuses/poll-1`
  })
}

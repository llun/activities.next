import { ACTOR1_ID, seedActor1 } from '../seed/actor1'
import { ACTOR2_ID, seedActor2 } from '../seed/actor2'
import { ACTOR3_ID, seedActor3 } from '../seed/actor3'
import { ACTOR4_ID, seedActor4 } from '../seed/actor4'
import { ACTOR5_ID, seedActor5 } from '../seed/actor5'
import { ACTOR6_ID, seedActor6 } from '../seed/actor6'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_FOLLOWERS,
  EXTERNAL_ACTOR1_INBOX
} from '../seed/external1'

export const DatabaseSeed = {
  actors: {
    primary: {
      id: ACTOR1_ID,
      username: seedActor1.username,
      domain: seedActor1.domain
    },
    replyAuthor: {
      id: ACTOR2_ID,
      username: seedActor2.username,
      domain: seedActor2.domain
    },
    pollAuthor: {
      id: ACTOR3_ID,
      username: seedActor3.username,
      domain: seedActor3.domain
    },
    extra: {
      id: ACTOR4_ID,
      username: seedActor4.username,
      domain: seedActor4.domain
    },
    followRequester: {
      id: ACTOR5_ID,
      username: seedActor5.username,
      domain: seedActor5.domain
    },
    empty: {
      id: ACTOR6_ID,
      username: seedActor6.username,
      domain: seedActor6.domain
    }
  },
  statuses: {
    primary: {
      post: `${ACTOR1_ID}/statuses/post-1`,
      secondPost: `${ACTOR1_ID}/statuses/post-2`,
      postWithAttachments: `${ACTOR1_ID}/statuses/post-3`
    },
    replyAuthor: {
      mentionReplyToPrimary: `${ACTOR2_ID}/statuses/post-2`,
      replyToPrimary: `${ACTOR2_ID}/statuses/reply-1`,
      announceOwn: `${ACTOR2_ID}/statuses/post-3`,
      announcePrimary: `${ACTOR2_ID}/statuses/announce-1`
    },
    poll: {
      status: `${ACTOR3_ID}/statuses/poll-1`
    }
  },
  follows: {
    primaryFollowerExternal: {
      actorId: 'https://somewhere.test/actors/friend',
      targetActorId: ACTOR1_ID,
      inbox: 'https://somewhere.test/inbox/friend',
      sharedInbox: 'https://somewhere.test/inbox'
    },
    primaryFollowingExternal: {
      actorId: ACTOR1_ID,
      targetActorId: EXTERNAL_ACTOR1,
      inbox: EXTERNAL_ACTOR1_INBOX,
      sharedInbox: EXTERNAL_ACTOR1_INBOX
    },
    primaryFollowingRemote: {
      actorId: ACTOR1_ID,
      targetActorId: 'https://llun.dev/users/test2'
    },
    primaryFollowingRequested: {
      actorId: ACTOR1_ID,
      targetActorId: 'https://somewhere.test/actors/request-following'
    },
    followRequesterPending: {
      actorId: ACTOR5_ID,
      targetActorId: ACTOR1_ID
    },
    replyAuthorFollowingRemote: {
      actorId: ACTOR2_ID,
      targetActorId: 'https://llun.dev/users/test2'
    },
    replyAuthorFollowerExternal: {
      actorId: EXTERNAL_ACTOR1,
      targetActorId: ACTOR2_ID
    },
    pollAuthorFollowingReplyAuthor: {
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID
    },
    pollAuthorFollowingExtra: {
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    }
  },
  externalActors: {
    primary: {
      id: EXTERNAL_ACTOR1,
      inbox: EXTERNAL_ACTOR1_INBOX,
      followersUrl: EXTERNAL_ACTOR1_FOLLOWERS
    }
  }
} as const

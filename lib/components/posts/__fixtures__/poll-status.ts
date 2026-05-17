import { StatusPoll, StatusType } from '@/lib/types/domain/status'

export const pollStatusCurrentTime = new Date(
  '2026-04-26T10:00:00.000Z'
).getTime()

export const pollStatusFixture: StatusPoll = {
  id: 'https://activities.local/users/llun/statuses/poll-1',
  actorId: 'https://activities.local/users/llun',
  actor: {
    id: 'https://activities.local/users/llun',
    username: 'llun',
    domain: 'activities.local',
    name: 'Llun',
    followersUrl: 'https://activities.local/users/llun/followers',
    inboxUrl: 'https://activities.local/users/llun/inbox',
    sharedInboxUrl: 'https://activities.local/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: pollStatusCurrentTime
  },
  to: [],
  cc: [],
  edits: [],
  attachments: [],
  isLocalActor: true,
  createdAt: pollStatusCurrentTime,
  updatedAt: pollStatusCurrentTime,
  type: StatusType.enum.Poll,
  url: 'https://activities.local/@llun/poll-1',
  text: 'Question',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  tags: [],
  endAt: new Date('2026-12-31T10:00:00.000Z').getTime(),
  choices: [
    {
      title: 'Option A',
      totalVotes: 2,
      statusId: 'https://activities.local/users/llun/statuses/poll-1',
      createdAt: pollStatusCurrentTime,
      updatedAt: pollStatusCurrentTime
    },
    {
      title: 'Option B',
      totalVotes: 1,
      statusId: 'https://activities.local/users/llun/statuses/poll-1',
      createdAt: pollStatusCurrentTime,
      updatedAt: pollStatusCurrentTime
    }
  ],
  pollType: 'oneOf'
}

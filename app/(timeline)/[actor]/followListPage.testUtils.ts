export const createLocalProfileData = ({
  followersCount,
  followingCount
}: {
  followersCount: number
  followingCount: number
}) => ({
  person: {
    id: 'https://llun.social/users/localuser',
    preferredUsername: 'localuser'
  } as never,
  followersCount,
  followingCount,
  statusesCount: 0,
  attachments: [],
  isInternalAccount: true,
  hasFitnessData: false,
  hasGalleryMedia: false,
  gallerySubviews: [],
  statuses: [],
  statusPagination: { nextPageUrl: null, prevPageUrl: null }
})

export const createFollowRecord = ({
  id,
  actorId,
  targetActorId,
  timestamp
}: {
  id: string
  actorId: string
  targetActorId: string
  timestamp: number
}) => ({
  id,
  actorId,
  targetActorId,
  status: 'Accepted',
  createdAt: timestamp,
  updatedAt: timestamp
})

export const createFollowListActor = (username: string, name: string) => ({
  id: `https://llun.social/users/${username}`,
  username,
  domain: 'llun.social',
  name,
  summary: '',
  iconUrl: '',
  headerImageUrl: '',
  followersUrl: `https://llun.social/users/${username}/followers`,
  inboxUrl: `https://llun.social/users/${username}/inbox`,
  sharedInboxUrl: 'https://llun.social/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0
})

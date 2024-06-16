export const EXTERNAL_ACTOR1 = 'https://llun.dev/users/test1'
export const EXTERNAL_ACTOR1_USER = 'test1'
export const EXTERNAL_ACTOR1_FOLLOWERS = `${EXTERNAL_ACTOR1}/followers`
export const EXTERNAL_ACTOR1_INBOX = `${EXTERNAL_ACTOR1}/inbox`

export const seedExternal1 = {
  actorId: EXTERNAL_ACTOR1,
  username: EXTERNAL_ACTOR1_USER,
  passwordHash: 'passwordhash',
  domain: 'llun.dev',
  inboxUrl: EXTERNAL_ACTOR1_INBOX,
  sharedInboxUrl: EXTERNAL_ACTOR1_INBOX,
  followersUrl: EXTERNAL_ACTOR1_FOLLOWERS,
  publicKey: 'publicKey',
  createdAt: Date.now(),
  followersCount: 0,
  followingCount: 0
}

export const TEST_DOMAIN = 'test.llun.dev'
export const TEST_DOMAIN_2 = 'test2.llun.dev'
export const TEST_DOMAIN_3 = 'test3.llun.dev'

export const TEST_USERNAME = 'test'
export const TEST_USERNAME2 = 'test2'
export const TEST_USERNAME3 = 'test3'

export const TEST_PASSWORD_HASH = 'password_hash'

export const TEST_EMAIL = `${TEST_USERNAME}@${TEST_DOMAIN}`
export const TEST_EMAIL2 = `${TEST_USERNAME2}@${TEST_DOMAIN}`

export const EXTERNAL_ACTORS = [
  {
    id: 'https://external_actor_domain/u/actor_id',
    username: 'actor_id',
    name: 'actor_name',
    domain: 'external_actor_domain',
    followers_url: `https://external_actor_domain/u/actor_id/followers`,
    inbox_url: `https://external_actor_domain/u/actor_id/inbox`
  },
  {
    id: 'https://external_actor_domain/u/actor_id2',
    username: 'actor_id2',
    name: 'actor_name2',
    domain: 'external_actor_domain',
    followers_url: 'https://external_actor_domain/u/actor_id2/followers',
    inbox_url: 'https://external_actor_domain/u/actor_id2/inbox'
  }
]

export const testUserId = (username: string) =>
  `https://${TEST_DOMAIN}/users/${username}`

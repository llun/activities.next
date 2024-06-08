export const TEST_DOMAIN = 'test.llun.dev'
export const TEST_DOMAIN_2 = 'test2.llun.dev'
export const TEST_DOMAIN_3 = 'test3.llun.dev'

export const TEST_USERNAME = 'test'
export const TEST_USERNAME2 = 'test2'

export const TEST_PASSWORD_HASH = 'password_hash'

export const TEST_EMAIL = `${TEST_USERNAME}@${TEST_DOMAIN}`
export const TEST_EMAIL2 = `${TEST_USERNAME2}@${TEST_DOMAIN}`

export const testUserId = (username: string) =>
  `https://${TEST_DOMAIN}/users/${username}`

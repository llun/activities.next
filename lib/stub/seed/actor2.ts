export const ACTOR2_ID = 'https://llun.test/users/test2'
export const ACTOR2_FOLLOWER_URL = `${ACTOR2_ID}/followers`

export const seedActor2 = {
  email: 'test2@llun.test',
  username: 'test2',
  passwordHash: 'test2password',
  domain: 'llun.test',
  publicKey:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEApXlmHptARBkiutS1e1iO\n' +
    'CshYRCH6nRkQ2RDR6se/BPIFX7HybP/HdT8eN+C2iAMeBRjXTXeLnLXlihmnxFvM\n' +
    'cMX6uLETaDvEDPgLOlU6WRBvjh+x6CJbj+PuOM5bmaoJHapYmJYvp+SiPulhfahi\n' +
    'QP8GdbNWKxwVqLFdOtF5nQdxFUBmzJ+I66S5AXWScyLaN/L+2sYm2eCfDsB+zcxo\n' +
    'otXv3BpZZW9oHj8XojI+xRdcoPy5063ZqIFOVofFMqn+uIZFJULLf9ZLH1w4pD6G\n' +
    'CrbUE1Sjq4ysBXazlmyOqyMxWeE3voSUxtnUHyi0ykgJACxVhBmJCT8tPm/PU7o+\n' +
    'sEVN2FwbWBHDgF3n6//Yu6Bn6AeAcm+v0wJSs2xPzuqU8l6L6zlH1EWK91CAThl/\n' +
    'KziztveI7UL3UEy4fVh8xpEZgg6B/JCJlqcLHKfu3787/EHGWcNKWxod+8It8wYX\n' +
    'iPy3ugKzy6J8wsRh80VIP6vDDFQCsvR54aJlOLIKdGVTGSZudCMOv8lP65K+i4dg\n' +
    'o+ZKsMHacx1I6hwP9YRSEWNims898fcOqmzALNXhE0oFssvdAkaS+kzsqK/7O8QN\n' +
    'T16rsVj2EvNJkin9mdCSnGhh94rtH4Lnu9veGMZO5T06htl66i1X9mc/Han20LNh\n' +
    '7mdd4pfTzuWDzz5/KoP4HO8CAwEAAQ==\n' +
    '-----END PUBLIC KEY-----\n',
  privateKey:
    '-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
    '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\n' +
    '-----END ENCRYPTED PRIVATE KEY-----\n',
  followersCount: 0,
  followingCount: 0
}

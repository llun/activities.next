import { LOCAL_USERNAME_MAX_LENGTH } from '@/lib/services/accounts/localUsername'
import { FEDERATION_SIGNING_ACTOR_USERNAME } from '@/lib/services/federation/instanceActor'

import { CreateAccountRequest } from './types'

describe('CreateAccountRequest', () => {
  it('rejects the reserved federation signing actor username', () => {
    const parsed = CreateAccountRequest.safeParse({
      username: FEDERATION_SIGNING_ACTOR_USERNAME,
      name: '',
      email: 'test@example.com',
      password: 'password123'
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects usernames in the federation signing actor namespace', () => {
    const parsed = CreateAccountRequest.safeParse({
      username: `${FEDERATION_SIGNING_ACTOR_USERNAME}abc`,
      name: '',
      email: 'test@example.com',
      password: 'password123'
    })

    expect(parsed.success).toBe(false)
  })

  // A username becomes an unencoded path segment of the actor's canonical id,
  // and a path segment is percent-DECODED on the way back in, so registering
  // `%6eull` would mint an id that dereferences to whoever owns `null`.
  it.each([['%6eull'], ['%6Eull'], ['nul%6c'], ['a%2Fb'], ['a/b']])(
    'rejects the username %j, which would decode to another actor id',
    (username) => {
      const parsed = CreateAccountRequest.safeParse({
        username,
        name: '',
        email: 'test@example.com',
        password: 'password123'
      })

      expect(parsed.success).toBe(false)
    }
  )

  it('still accepts a username that merely reads as a null literal', () => {
    const parsed = CreateAccountRequest.safeParse({
      username: 'null',
      name: '',
      email: 'test@example.com',
      password: 'password123'
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.username).toBe('null')
  })

  // Registration carried no length limit at all before it shared a schema with
  // `POST /api/v1/actors`, so this bound is new here rather than preserved.
  // `actors.username` is varchar(255): an over-long name used to overflow the
  // column and 500 on PostgreSQL instead of being refused.
  it('bounds the username length that registration accepts', () => {
    const parse = (username: string) =>
      CreateAccountRequest.safeParse({
        username,
        name: '',
        email: 'test@example.com',
        password: 'password123'
      })

    expect(parse('a'.repeat(LOCAL_USERNAME_MAX_LENGTH)).success).toBe(true)
    expect(parse('a'.repeat(LOCAL_USERNAME_MAX_LENGTH + 1)).success).toBe(false)
  })
})

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
})

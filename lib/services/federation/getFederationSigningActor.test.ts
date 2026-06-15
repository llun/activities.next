import { Database } from '@/lib/database/types'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME
} from '@/lib/services/federation/instanceActor'
import { Actor } from '@/lib/types/domain/actor'

import { getFederationSigningActor } from './getFederationSigningActor'

const serviceActor = {
  id: 'https://example.com/users/__instance__',
  type: FEDERATION_SIGNING_ACTOR_TYPE,
  username: FEDERATION_SIGNING_ACTOR_USERNAME,
  domain: 'example.com',
  privateKey: 'service-private-key'
} as Actor

const userActor = {
  id: 'https://example.com/users/alice',
  type: 'Person',
  username: 'alice',
  domain: 'example.com',
  privateKey: 'user-private-key'
} as Actor

describe('getFederationSigningActor', () => {
  it('reuses an already resolved headless instance actor', async () => {
    const database = {
      getFederationSigningActor: vi.fn()
    } as unknown as Database

    await expect(
      getFederationSigningActor(database, serviceActor)
    ).resolves.toBe(serviceActor)
    expect(database.getFederationSigningActor).not.toHaveBeenCalled()
  })

  it('does not reuse a real user actor as the federation signing actor', async () => {
    const database = {
      getFederationSigningActor: vi.fn().mockResolvedValue(serviceActor)
    } as unknown as Database

    await expect(getFederationSigningActor(database, userActor)).resolves.toBe(
      serviceActor
    )
    expect(database.getFederationSigningActor).toHaveBeenCalledTimes(1)
  })
})

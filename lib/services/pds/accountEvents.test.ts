import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

import { appendPdsAccountStatusEvent } from './accountEvents'

const PDS_HOSTNAME = `pds.${TEST_DOMAIN}`

const movedOperation = JSON.stringify({
  type: 'plc_operation',
  services: {
    atproto_pds: {
      type: 'AtprotoPersonalDataServer',
      endpoint: 'https://bsky.social'
    }
  }
})

describe('appendPdsAccountStatusEvent', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let originalPdsEnv: string | undefined

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: { enabled: true, hostname: PDS_HOSTNAME }
    })
  })

  afterEach(() => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
  })

  const seedRepo = async (
    username: string,
    plcOperation: string | null
  ): Promise<{ actorId: string; did: string }> => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `priv-${username}`,
      publicKey: `pub-${username}`
    })
    const actor = await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })
    if (!actor) throw new Error(`Missing actor ${username}`)
    const did = `did:web:${username}.${PDS_HOSTNAME}`
    await database.createPdsRepo({
      did,
      actorId: actor.id,
      domain: TEST_DOMAIN,
      signingKey: `v1:key-${username}`,
      signingKeyDid: `did:key:zQ3sh${username}`,
      status: 'active',
      plcOperation
    })
    return { actorId: actor.id, did }
  }

  it('appends an #account event for a repo still hosted here', async () => {
    const { actorId, did } = await seedRepo('events-hosted', null)

    const event = await appendPdsAccountStatusEvent(testDb.db, {
      actorId,
      active: false,
      status: 'suspended'
    })

    expect(event).not.toBeNull()
    expect(event?.did).toBe(did)
    expect(event?.type).toBe('account')
  })

  it('appends no #account event for a repo that moved to another PDS', async () => {
    const { actorId, did } = await seedRepo('events-moved', movedOperation)

    const event = await appendPdsAccountStatusEvent(testDb.db, {
      actorId,
      active: false,
      status: 'suspended'
    })

    expect(event).toBeNull()
    expect(await database.listPdsEvents({ did })).toEqual([])
  })
})

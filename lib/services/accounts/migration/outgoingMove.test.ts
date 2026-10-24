import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getQueue } from '@/lib/services/queue'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'

import { performOutgoingMove } from './outgoingMove'

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

describe('performOutgoingMove on a real database', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const publish = vi.fn()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })
  afterAll(async () => {
    await testDb.destroy()
  })
  beforeEach(() => {
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
  })

  const setup = async (name: string) => {
    const actorId = `https://llun.test/users/${name}`
    await database.createActor({
      actorId,
      username: name,
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'publicKey',
      createdAt: Date.now()
    })
    const actor = (await database.getActorFromId({ id: actorId })) as Actor
    // A local target is read from its row, so no fetch is involved.
    const target = Actor.parse({
      ...MockActor({ id: `https://other.test/users/${name}` }),
      alsoKnownAs: [actorId]
    })
    return { actor, target }
  }

  it('records one move and one job id for two concurrent requests', async () => {
    const { actor, target } = await setup('concurrent')
    const results = await Promise.all([
      performOutgoingMove({ database, actor, target, kind: 'move' }),
      performOutgoingMove({ database, actor, target, kind: 'move' })
    ])
    expect(results).toEqual([{ ok: true }, { ok: true }])

    const rows = await database.getActorMigrations({ actorId: actor.id })
    expect(rows).toHaveLength(1)
    const ids = new Set(publish.mock.calls.map(([job]) => job.id))
    expect(ids).toEqual(new Set([`${rows[0].id}:start`]))
  })

  it('completes the move on a retry after the queue failed', async () => {
    const { actor, target } = await setup('retry')
    publish.mockRejectedValueOnce(new Error('queue down'))
    expect(
      await performOutgoingMove({ database, actor, target, kind: 'move' })
    ).toMatchObject({ ok: false, status: 503 })

    const stored = (await database.getActorFromId({ id: actor.id })) as Actor
    expect(stored.movedTo).toBe(target.id)
    expect(
      await performOutgoingMove({
        database,
        actor: stored,
        target,
        kind: 'move'
      })
    ).toEqual({ ok: true })

    const rows = await database.getActorMigrations({ actorId: actor.id })
    expect(rows).toHaveLength(1)
    expect(publish.mock.calls.map(([job]) => job.id)).toEqual([
      `${rows[0].id}:start`,
      `${rows[0].id}:start`
    ])
  })
})

import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { getQueue } from '@/lib/services/queue'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'

import { performOutgoingMove } from './outgoingMove'

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))
vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: vi.fn()
}))

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
  afterEach(() => {
    vi.useRealTimers()
  })
  beforeEach(() => {
    vi.mocked(publishActorUpdate).mockClear()
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
    // Neither publish settles before both requests reached it, so neither
    // request marks the move started before the other one was recorded.
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    publish.mockImplementation(async () => {
      if (publish.mock.calls.length >= 2) release()
      await gate
    })
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
      (await database.getActorMigrations({ actorId: actor.id }))[0].startedAt
    ).toBeNull()
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
    expect(rows[0].startedAt).toBeGreaterThan(0)
    expect(publish.mock.calls.map(([job]) => job.id)).toEqual([
      `${rows[0].id}:start`,
      `${rows[0].id}:start`
    ])
  })

  it('marks the move started after a successful publish', async () => {
    const { actor, target } = await setup('started')
    await performOutgoingMove({ database, actor, target, kind: 'move' })
    const [row] = await database.getActorMigrations({ actorId: actor.id })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(row.startedAt).toBeGreaterThan(0)
  })

  it('records the move as verified on a normal successful move', async () => {
    const { actor, target } = await setup('verified')
    const record = vi.spyOn(database, 'recordActorMigration')
    await performOutgoingMove({ database, actor, target, kind: 'move' })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ aliasVerified: true })
    )
    record.mockRestore()
  })

  it('answers 429 and publishes nothing when the move was recorded unverified', async () => {
    const { actor, target } = await setup('unverified')
    const record = vi
      .spyOn(database, 'recordActorMigration')
      .mockResolvedValueOnce({ status: 'unverified' } as never)
    expect(
      await performOutgoingMove({ database, actor, target, kind: 'move' })
    ).toEqual({
      ok: false,
      status: 429,
      error: 'The move changed while it was checked, try again',
      cooldownUntil: undefined
    })
    expect(publish).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
    record.mockRestore()
  })

  it('answers 422 to a repeat of a successful move without a job or an Update', async () => {
    const { actor, target } = await setup('repeat')
    await performOutgoingMove({ database, actor, target, kind: 'move' })
    publish.mockClear()
    vi.mocked(publishActorUpdate).mockClear()

    const stored = (await database.getActorFromId({ id: actor.id })) as Actor
    expect(
      await performOutgoingMove({
        database,
        actor: stored,
        target,
        kind: 'move'
      })
    ).toMatchObject({ ok: false, status: 422 })
    expect(publish).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
    expect(
      await database.getActorMigrations({ actorId: actor.id })
    ).toHaveLength(1)
  })

  const cancelAndRedirect = async (actor: Actor, target: Actor) => {
    // DELETE /api/v1/accounts/migration clears movedTo, then a redirect to the
    // same account sets it again.
    await database.updateActor({ actorId: actor.id, movedTo: null })
    expect(
      await performOutgoingMove({
        database,
        actor: (await database.getActorFromId({ id: actor.id })) as Actor,
        target,
        kind: 'redirect'
      })
    ).toEqual({ ok: true })
    publish.mockClear()
    vi.mocked(publishActorUpdate).mockClear()
    return (await database.getActorFromId({ id: actor.id })) as Actor
  }

  const moveAgain = (actor: Actor, target: Actor) =>
    performOutgoingMove({ database, actor, target, kind: 'move' })

  it('does not re-send a cancelled move that was redirected to the same account', async () => {
    const { actor, target } = await setup('cancelled')
    publish.mockRejectedValueOnce(new Error('queue down'))
    await moveAgain(actor, target)
    const stored = await cancelAndRedirect(actor, target)
    expect(stored.movedTo).toBe(target.id)

    const record = vi.spyOn(database, 'recordActorMigration')
    expect(await moveAgain(stored, target)).toMatchObject({
      ok: false,
      status: 429
    })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ aliasVerified: false })
    )
    record.mockRestore()
    expect(publish).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('answers 429 without fetching the target for a cancelled move redirected to the same remote account', async () => {
    const { actor, target } = await setup('redirected-remote')
    publish.mockRejectedValueOnce(new Error('queue down'))
    await moveAgain(actor, target)
    const stored = await cancelAndRedirect(actor, target)
    vi.mocked(getActorPerson)
      .mockReset()
      .mockResolvedValue(null as never)
    vi.mocked(getFederationSigningActorSafe).mockResolvedValue({
      id: 'https://llun.test/users/signer'
    } as Actor)

    expect(
      await moveAgain(stored, Actor.parse({ ...target, privateKey: undefined }))
    ).toMatchObject({ ok: false, status: 429 })
    expect(getActorPerson).not.toHaveBeenCalled()
  })

  it('answers 422 to a started move that was redirected to the same account', async () => {
    const { actor, target } = await setup('started-redirected')
    await moveAgain(actor, target)
    const stored = await cancelAndRedirect(actor, target)

    expect(await moveAgain(stored, target)).toMatchObject({
      ok: false,
      status: 422
    })
    expect(publish).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  it('answers 429 to a started move repeated after the move was cancelled', async () => {
    const { actor, target } = await setup('started-cancelled')
    await moveAgain(actor, target)
    await database.updateActor({ actorId: actor.id, movedTo: null })
    publish.mockClear()
    vi.mocked(publishActorUpdate).mockClear()

    expect(
      await moveAgain(
        (await database.getActorFromId({ id: actor.id })) as Actor,
        target
      )
    ).toMatchObject({ ok: false, status: 429 })
    expect(publish).not.toHaveBeenCalled()
    expect(publishActorUpdate).not.toHaveBeenCalled()
  })

  describe('reading a remote target', () => {
    const remote = async (name: string) => {
      const { actor, target } = await setup(name)
      return {
        actor,
        target: Actor.parse({ ...target, privateKey: undefined })
      }
    }

    it('answers 502 when the target cannot be fetched', async () => {
      const { actor, target } = await remote('fetch-fails')
      vi.mocked(getFederationSigningActorSafe).mockResolvedValue({
        id: 'https://llun.test/users/signer'
      } as Actor)
      vi.mocked(getActorPerson).mockResolvedValue(null as never)

      expect(
        await performOutgoingMove({ database, actor, target, kind: 'move' })
      ).toMatchObject({ ok: false, status: 502 })
      expect(publish).not.toHaveBeenCalled()
    })

    it('answers 429 without fetching an unreachable target while in cooldown', async () => {
      const { actor, target } = await setup('cooldown-first')
      expect(
        await performOutgoingMove({ database, actor, target, kind: 'move' })
      ).toEqual({ ok: true })
      const { target: other } = await remote('cooldown-second')
      vi.mocked(getFederationSigningActorSafe).mockResolvedValue({
        id: 'https://llun.test/users/signer'
      } as Actor)
      vi.mocked(getActorPerson).mockClear()
      vi.mocked(getActorPerson).mockResolvedValue(null as never)

      expect(
        await performOutgoingMove({
          database,
          actor: (await database.getActorFromId({ id: actor.id })) as Actor,
          target: other,
          kind: 'move'
        })
      ).toMatchObject({ ok: false, status: 429 })
      expect(getActorPerson).not.toHaveBeenCalled()
    })

    it('answers 500 when there is no signing actor to fetch with', async () => {
      const { actor, target } = await remote('no-signer')
      vi.mocked(getFederationSigningActorSafe).mockResolvedValue(undefined)
      vi.mocked(getActorPerson).mockClear()

      expect(
        await performOutgoingMove({ database, actor, target, kind: 'move' })
      ).toEqual({
        ok: false,
        status: 500,
        error: 'This server cannot fetch remote accounts right now',
        cooldownUntil: undefined
      })
      expect(getActorPerson).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  })
})

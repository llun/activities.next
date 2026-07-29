import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import { resolveConsentReferenceId } from './consentReferenceId'

const ACCOUNT_ID = 'account-1'
const FIRST_ACTOR = 'https://llun.test/users/first'
const SECOND_ACTOR = 'https://llun.test/users/second'

const actor = (id: string, deletionStatus?: Actor['deletionStatus']): Actor =>
  ({ id, deletionStatus: deletionStatus ?? null }) as Actor

const databaseWith = ({
  defaultActorId = null,
  actors = [actor(FIRST_ACTOR), actor(SECOND_ACTOR)]
}: {
  defaultActorId?: string | null
  actors?: Actor[]
} = {}) =>
  ({
    getAccountFromId: vi
      .fn()
      .mockResolvedValue({ id: ACCOUNT_ID, defaultActorId }),
    getActorsForAccount: vi.fn().mockResolvedValue(actors)
  }) as unknown as Database

describe('resolveConsentReferenceId', () => {
  it('returns the session actor when the session already selected one', async () => {
    const database = databaseWith()
    const referenceId = await resolveConsentReferenceId({
      database,
      session: { userId: ACCOUNT_ID, actorId: SECOND_ACTOR }
    })

    expect(referenceId).toEqual(SECOND_ACTOR)
    expect(database.getActorsForAccount).not.toHaveBeenCalled()
  })

  it('falls back to the account default actor when the session has none', async () => {
    const referenceId = await resolveConsentReferenceId({
      database: databaseWith({ defaultActorId: SECOND_ACTOR }),
      session: { userId: ACCOUNT_ID, actorId: null }
    })

    expect(referenceId).toEqual(SECOND_ACTOR)
  })

  it('falls back to the first live actor when the account never set a default', async () => {
    const referenceId = await resolveConsentReferenceId({
      database: databaseWith({ defaultActorId: null }),
      session: { userId: ACCOUNT_ID, actorId: null }
    })

    expect(referenceId).toEqual(FIRST_ACTOR)
  })

  it('returns undefined when the account owns no usable actor', async () => {
    const referenceId = await resolveConsentReferenceId({
      database: databaseWith({ actors: [actor(FIRST_ACTOR, 'scheduled')] }),
      session: { userId: ACCOUNT_ID }
    })

    expect(referenceId).toBeUndefined()
  })

  it('returns undefined without a database or a session user', async () => {
    expect(
      await resolveConsentReferenceId({
        database: null,
        session: { userId: ACCOUNT_ID }
      })
    ).toBeUndefined()
    expect(
      await resolveConsentReferenceId({
        database: databaseWith(),
        session: null
      })
    ).toBeUndefined()
  })

  it('returns undefined instead of throwing when the lookup fails', async () => {
    const database = {
      getAccountFromId: vi
        .fn()
        .mockRejectedValue(new Error('database is down')),
      getActorsForAccount: vi.fn().mockResolvedValue([])
    } as unknown as Database

    expect(
      await resolveConsentReferenceId({
        database,
        session: { userId: ACCOUNT_ID }
      })
    ).toBeUndefined()
  })
})

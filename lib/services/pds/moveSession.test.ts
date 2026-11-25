import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'

import { PdsMoveOutNotFoundError } from './errors'
import {
  deleteMoveOutSession,
  readMoveOutSession,
  updateMoveOutSession
} from './moveSession'

const DID_A = 'did:plc:movesessiontest0000000000a'
const DID_B = 'did:plc:movesessiontest0000000000b'
const DID_C = 'did:plc:movesessiontest0000000000c'

const moveSession = (overrides: Record<string, unknown> = {}) => ({
  type: 'move-out' as const,
  pdsUrl: 'https://dest.pds.example',
  destDid: 'did:web:dest.pds.example',
  handle: 'alice.dest.pds.example',
  accessJwt: 'access-a',
  refreshJwt: 'refresh-a',
  importedRev: null,
  switchedAt: null,
  ...overrides
})

describe('move session storage', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('patches only non-token fields and never overwrites fresher tokens', async () => {
    await writeStoredBlueskySession(database, DID_A, moveSession())
    // A refresh lands and stores newer tokens.
    await writeStoredBlueskySession(
      database,
      DID_A,
      moveSession({ accessJwt: 'access-b', refreshJwt: 'refresh-b' })
    )

    // A caller holding the stale session passes its tokens along; they must be
    // ignored so the refreshed ones survive.
    const updated = await updateMoveOutSession(database, DID_A, {
      importedRev: '3krev',
      accessJwt: 'access-a',
      refreshJwt: 'refresh-a'
    } as never)

    expect(updated).toMatchObject({
      accessJwt: 'access-b',
      refreshJwt: 'refresh-b',
      importedRev: '3krev'
    })
    expect(await readStoredBlueskySession(database, DID_A)).toMatchObject({
      accessJwt: 'access-b',
      refreshJwt: 'refresh-b',
      importedRev: '3krev'
    })
  })

  it('refuses to patch a move that is gone', async () => {
    await expect(
      updateMoveOutSession(database, DID_B, { switchedAt: 1 })
    ).rejects.toBeInstanceOf(PdsMoveOutNotFoundError)
  })

  it('deletes only a move-out session and is a no-op when gone', async () => {
    await writeStoredBlueskySession(database, DID_C, moveSession())
    await deleteMoveOutSession(database, DID_C)
    expect(await readMoveOutSession(database, DID_C)).toBeNull()
    await expect(deleteMoveOutSession(database, DID_C)).resolves.toBeUndefined()
  })
})

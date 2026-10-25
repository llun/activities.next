import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { JOBS } from '@/lib/jobs'
import { RENAME_STATUS_URLS_JOB_NAME } from '@/lib/jobs/names'
import {
  RENAME_STATUS_URLS_PAGE_SIZE,
  getStatusUrlPrefix,
  renameStatusUrlsJob,
  renameStatusUrlsJobId
} from '@/lib/jobs/renameStatusUrlsJob'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { getHashFromString } from '@/lib/utils/getHashFromString'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const OLD_PREFIX = 'https://old.example/@al_ce/'
const NEW_PREFIX = 'https://new.example/@renamed/'
const RENAMED_AT = Date.parse('2026-01-01T00:00:00.000Z')

const run = (
  database: Database,
  actorId: string,
  after: string | null = null
) =>
  renameStatusUrlsJob(database, {
    id: renameStatusUrlsJobId('handle-1', RENAMED_AT, after ?? undefined),
    name: RENAME_STATUS_URLS_JOB_NAME,
    data: {
      handleId: 'handle-1',
      renamedAt: RENAMED_AT,
      actorId,
      fromPrefix: OLD_PREFIX,
      toPrefix: NEW_PREFIX,
      after
    }
  })

describe('renameStatusUrlsJob', () => {
  const testDb = createTestDatabase()
  let database: Database
  let db: Db

  const publish = vi.fn()

  const createActor = async (username: string, domain = TEST_DOMAIN) => {
    const accountId = await database.createAccount({
      email: `${username}-${crypto.randomUUID()}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain,
      privateKey: `private-key-${username}`,
      publicKey: `public-key-${username}`
    })
    const actors = await database.getActorsForAccount({ accountId })
    return actors[0].id
  }

  const insertStatus = (
    actorId: string,
    url: string | null,
    id = `${actorId}/statuses/${crypto.randomUUID()}`
  ) =>
    db
      .insertInto('statuses')
      .values({
        id,
        actorId,
        url,
        urlHash: url ? getHashFromString(url) : null,
        type: 'Note',
        content: null
      })
      .execute()

  const readStatus = async (id: string) =>
    db
      .selectFrom('statuses')
      .select(['id', 'url', 'urlHash'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

  beforeAll(async () => {
    await testDb.prepare()
    database = testDb.database
    db = testDb.db
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
  })

  it('is registered under its job name', () => {
    expect(JOBS[RENAME_STATUS_URLS_JOB_NAME]).toBe(renameStatusUrlsJob)
  })

  it('rewrites only the matching statuses of the renamed actor', async () => {
    const actorId = await createActor('wild_card')
    const otherActorId = await createActor('wildxce')

    const mine = `${actorId}/statuses/mine`
    const mineSecond = `${actorId}/statuses/mine-second`
    const otherHandle = `${actorId}/statuses/other-handle`
    const similar = `${otherActorId}/statuses/similar`
    const wildcard = `${otherActorId}/statuses/wildcard`
    await insertStatus(actorId, `${OLD_PREFIX}first`, mine)
    await insertStatus(actorId, `${OLD_PREFIX}second`, mineSecond)
    // An announce: a null url, never rewritten.
    await insertStatus(actorId, null, `${actorId}/statuses/boost`)
    // A status on a different profile prefix: untouched.
    await insertStatus(
      actorId,
      'https://elsewhere.example/@wild_card/elsewhere',
      otherHandle
    )
    // Another actor's status under the same prefix shape: untouched.
    await insertStatus(otherActorId, `${OLD_PREFIX}impostor`, similar)
    // A username one wildcard away (`alxce` matches an unescaped `al_ce`):
    // the escaped LIKE must not rewrite it.
    await insertStatus(
      otherActorId,
      'https://old.example/@alxce/one-off',
      wildcard
    )

    await run(database, actorId)

    expect(await readStatus(mine)).toEqual({
      id: mine,
      url: `${NEW_PREFIX}first`,
      urlHash: getHashFromString(`${NEW_PREFIX}first`)
    })
    expect(await readStatus(mineSecond)).toEqual({
      id: mineSecond,
      url: `${NEW_PREFIX}second`,
      urlHash: getHashFromString(`${NEW_PREFIX}second`)
    })
    expect((await readStatus(otherHandle)).url).toBe(
      'https://elsewhere.example/@wild_card/elsewhere'
    )
    expect((await readStatus(similar)).url).toBe(`${OLD_PREFIX}impostor`)
    expect((await readStatus(wildcard)).url).toBe(
      'https://old.example/@alxce/one-off'
    )
    // The whole page fit the budget: no continuation.
    expect(publish).not.toHaveBeenCalled()
  })

  it('does nothing on a second run: it is idempotent', async () => {
    const actorId = await createActor('idempotent')
    const statusId = `${actorId}/statuses/one`
    await insertStatus(actorId, `${OLD_PREFIX}one`, statusId)

    await run(database, actorId)
    const afterFirst = await readStatus(statusId)
    expect(afterFirst.url).toBe(`${NEW_PREFIX}one`)

    await run(database, actorId)
    expect(await readStatus(statusId)).toEqual(afterFirst)
    expect(publish).not.toHaveBeenCalled()
  })

  it('queues a continuation when the budget runs out, and the continuation finishes the work', async () => {
    vi.useFakeTimers()
    const originalRewrite = database.rewriteStatusUrl
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const actorId = await createActor('paged')
      const ids = Array.from(
        { length: RENAME_STATUS_URLS_PAGE_SIZE + 1 },
        (_, index) =>
          `${actorId}/statuses/page-${String(index).padStart(4, '0')}`
      )
      for (const id of ids) {
        await insertStatus(actorId, `${OLD_PREFIX}${id}`, id)
      }

      // The clock moves part-way through the FIRST page's rewrites: the page
      // finishes inside the loop, and the budget check after it sees the
      // deadline passed.
      let rewrites = 0
      database.rewriteStatusUrl = async (params) => {
        rewrites += 1
        if (rewrites === 100) {
          vi.setSystemTime(new Date('2026-01-01T00:00:21.000Z'))
        }
        return originalRewrite(params)
      }

      await run(database, actorId)

      // Only the first page was rewritten; the rest is handed to a
      // continuation keyed by the last id of that page.
      const lastFirstPageId = ids[RENAME_STATUS_URLS_PAGE_SIZE - 1]
      expect((await readStatus(ids[RENAME_STATUS_URLS_PAGE_SIZE])).url).toBe(
        `${OLD_PREFIX}${ids[RENAME_STATUS_URLS_PAGE_SIZE]}`
      )
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenCalledWith({
        id: renameStatusUrlsJobId('handle-1', RENAMED_AT, lastFirstPageId),
        name: RENAME_STATUS_URLS_JOB_NAME,
        data: {
          handleId: 'handle-1',
          renamedAt: RENAMED_AT,
          actorId,
          fromPrefix: OLD_PREFIX,
          toPrefix: NEW_PREFIX,
          after: lastFirstPageId
        }
      })

      await run(database, actorId, lastFirstPageId)
      expect((await readStatus(ids[RENAME_STATUS_URLS_PAGE_SIZE])).url).toBe(
        `${NEW_PREFIX}${ids[RENAME_STATUS_URLS_PAGE_SIZE]}`
      )
      expect(publish).toHaveBeenCalledTimes(1)
    } finally {
      database.rewriteStatusUrl = originalRewrite
      vi.useRealTimers()
    }
  })

  it('ignores a malformed payload', async () => {
    await expect(
      renameStatusUrlsJob(database, {
        id: 'malformed',
        name: RENAME_STATUS_URLS_JOB_NAME,
        data: { actorId: 42 }
      })
    ).resolves.toBeUndefined()
    expect(publish).not.toHaveBeenCalled()
  })

  it('builds the profile prefix the mint paths embed in statuses.url', () => {
    // The domain is NOT lowercased: statuses.url is minted from
    // actor.domain as stored, and a legacy mixed-case domain must match its
    // own statuses.
    expect(getStatusUrlPrefix({ domain: 'Example.test', username: 'me' })).toBe(
      'https://Example.test/@me/'
    )
  })

  it('gives every rename its own job ids, keyed by the rename timestamp', () => {
    // A rename back reuses the revived ledger row's handleId; without the
    // timestamp a queue that still holds the earlier job would drop the new
    // one as a duplicate id.
    expect(renameStatusUrlsJobId('handle-1', RENAMED_AT)).toBe(
      `handle-1:${RENAMED_AT}:statusUrls:start`
    )
    expect(renameStatusUrlsJobId('handle-1', RENAMED_AT, 'abc')).toBe(
      `handle-1:${RENAMED_AT}:statusUrls:abc`
    )
    expect(renameStatusUrlsJobId('handle-1', RENAMED_AT)).not.toBe(
      renameStatusUrlsJobId('handle-1', RENAMED_AT + 1)
    )
  })

  it('rewrites statuses minted under a handle the actor renamed back to in a new casing', async () => {
    // alice → bob → ALICE (a rename BACK onto its own retired row, in a new
    // casing) → carol: the revive must rewrite the ledger row's spelling to
    // ALICE, and the third rename's `previous` must be the actors row's
    // stored spelling (ALICE), not the ledger row's retired casing (alice),
    // or the statuses minted under @ALICE are never matched.
    const actorId = await createActor('alice')
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const rename = (username: string, at: number) =>
      database.recordActorHandleRename({
        actorId,
        username,
        domain: TEST_DOMAIN,
        now: new Date(at),
        cooldownMs: 0
      })
    await rename('bob', t0)
    await rename('ALICE', t0 + 1)
    const third = await rename('carol', t0 + 2)
    if (!third.ok) throw new Error(`expected ok, got ${third.status}`)
    expect(third.previous).toEqual({ username: 'ALICE', domain: TEST_DOMAIN })
    expect(third.renamedAt).toBe(t0 + 2)

    // The revived row carries the target's exact spelling, so the history
    // never shows a casing the actor does not hold.
    const handles = await database.getActorHandles({ actorId })
    expect(handles.map((row) => row.username).sort()).toEqual([
      'ALICE',
      'bob',
      'carol'
    ])

    const statusId = `${actorId}/statuses/under-alice`
    await insertStatus(actorId, `https://${TEST_DOMAIN}/@ALICE/one`, statusId)

    await renameStatusUrlsJob(database, {
      id: renameStatusUrlsJobId(third.handleId, third.renamedAt),
      name: RENAME_STATUS_URLS_JOB_NAME,
      data: {
        handleId: third.handleId,
        renamedAt: third.renamedAt,
        actorId,
        fromPrefix: getStatusUrlPrefix(third.previous),
        toPrefix: getStatusUrlPrefix(third.current),
        after: null
      }
    })

    expect(await readStatus(statusId)).toEqual({
      id: statusId,
      url: `https://${TEST_DOMAIN}/@carol/one`,
      urlHash: getHashFromString(`https://${TEST_DOMAIN}/@carol/one`)
    })
  })

  it('rewrites statuses minted under a legacy mixed-case stored domain', async () => {
    const actorId = await createActor('mixedcase')
    // A legacy actors row whose domain was stored mixed-case, exactly as the
    // mint paths would have embedded it in statuses.url.
    await db
      .updateTable('actors')
      .set({ domain: 'Mixed.test' })
      .where('id', '=', actorId)
      .execute()
    const statusId = `${actorId}/statuses/mixed`
    await insertStatus(actorId, 'https://Mixed.test/@mixedcase/one', statusId)

    const result = await database.recordActorHandleRename({
      actorId,
      username: 'recased',
      domain: 'mixed.test',
      now: new Date(Date.parse('2026-01-01T00:00:00.000Z')),
      cooldownMs: 0
    })
    if (!result.ok) throw new Error(`expected ok, got ${result.status}`)
    expect(result.previous).toEqual({
      username: 'mixedcase',
      domain: 'Mixed.test'
    })

    await renameStatusUrlsJob(database, {
      id: renameStatusUrlsJobId(result.handleId, result.renamedAt),
      name: RENAME_STATUS_URLS_JOB_NAME,
      data: {
        handleId: result.handleId,
        renamedAt: result.renamedAt,
        actorId,
        fromPrefix: getStatusUrlPrefix(result.previous),
        toPrefix: getStatusUrlPrefix(result.current),
        after: null
      }
    })

    expect((await readStatus(statusId)).url).toBe(
      'https://mixed.test/@recased/one'
    )
  })
})

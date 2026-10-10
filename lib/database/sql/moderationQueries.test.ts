import crypto from 'crypto'
import { type Updateable, sql } from 'kysely'

import type { Accounts, Actors } from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getLocalActorId } from '@/lib/utils/activitypubId'

// Every `where` in the moderation queries, each pinned with a neighbouring row
// the query must not touch, and rejectPendingAccount rolling back as a whole
// when its last write fails. Runs on PostgreSQL in CI.

const DOMAIN = 'test.llun.dev'

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

const newAccount = async (label: string) => {
  const username = `${label}-${crypto.randomUUID().slice(0, 8)}`
  const email = `${username}@${DOMAIN}`
  const accountId = await database.createAccount({
    email,
    username,
    passwordHash: 'hash',
    domain: DOMAIN,
    privateKey: 'private',
    publicKey: 'public'
  })
  return {
    accountId,
    username,
    email,
    actorId: getLocalActorId({ domain: DOMAIN, username })
  }
}

const newRemoteActor = async (label: string, domain = 'remote.test') => {
  const username = `${label}-${crypto.randomUUID().slice(0, 8)}`
  const actorId = `https://${domain}/users/${username}`
  await database.createActor({
    actorId,
    username,
    domain,
    followersUrl: `${actorId}/followers`,
    inboxUrl: `${actorId}/inbox`,
    sharedInboxUrl: `https://${domain}/inbox`,
    publicKey: 'public',
    createdAt: Date.now()
  })
  return actorId
}

const actorRow = (id: string) =>
  db()
    .selectFrom('actors')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const accountRow = (id: string) =>
  db()
    .selectFrom('accounts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const patchAccount = (id: string, values: Updateable<Accounts>) =>
  db().updateTable('accounts').set(values).where('id', '=', id).execute()

const patchActor = (id: string, values: Updateable<Actors>) =>
  db().updateTable('actors').set(values).where('id', '=', id).execute()

const addSession = async (
  accountId: string,
  token: string,
  { ipAddress, updatedAt }: { ipAddress?: string; updatedAt?: Date } = {}
) => {
  await database.createAccountSession({
    accountId,
    token,
    expireAt: Date.now() + 60_000
  })
  if (ipAddress || updatedAt) {
    await db()
      .updateTable('sessions')
      .set({
        ...(ipAddress ? { ipAddress } : {}),
        ...(updatedAt ? { updatedAt } : {})
      })
      .where('token', '=', token)
      .execute()
  }
}

const sessionCount = async (accountId: string) =>
  (
    await db()
      .selectFrom('sessions')
      .select('id')
      .where('accountId', '=', accountId)
      .execute()
  ).length

describe('actor and account state', () => {
  it.each([
    {
      column: 'suspendedAt',
      set: (actorId: string, on: boolean) =>
        database.setActorSuspended({ actorId, suspended: on })
    },
    {
      column: 'silencedAt',
      set: (actorId: string, on: boolean) =>
        database.setActorSilenced({ actorId, silenced: on })
    },
    {
      column: 'sensitizedAt',
      set: (actorId: string, on: boolean) =>
        database.setActorSensitized({ actorId, sensitized: on })
    }
  ] as const)(
    '$column is written on the target actor only',
    async ({ column, set }) => {
      const neighbour = await newAccount('state-n')
      const target = await newAccount('state-t')
      const neighbourBefore = await actorRow(neighbour.actorId)

      await set(target.actorId, true)
      expect((await actorRow(target.actorId))[column]).toEqual(
        expect.any(Number)
      )
      expect(await actorRow(neighbour.actorId)).toEqual(neighbourBefore)

      await set(neighbour.actorId, true)
      await set(target.actorId, false)
      expect((await actorRow(target.actorId))[column]).toBeNull()
      expect((await actorRow(neighbour.actorId))[column]).toEqual(
        expect.any(Number)
      )
    }
  )

  it('disables and enables the target account only', async () => {
    const neighbour = await newAccount('disable-n')
    const target = await newAccount('disable-t')

    await database.setAccountDisabled({
      accountId: target.accountId,
      disabled: true
    })
    expect((await accountRow(target.accountId)).disabledAt).toEqual(
      expect.any(Number)
    )
    expect((await accountRow(neighbour.accountId)).disabledAt).toBeNull()

    await database.setAccountDisabled({
      accountId: neighbour.accountId,
      disabled: true
    })
    await database.setAccountDisabled({
      accountId: target.accountId,
      disabled: false
    })
    expect((await accountRow(target.accountId)).disabledAt).toBeNull()
    expect((await accountRow(neighbour.accountId)).disabledAt).toEqual(
      expect.any(Number)
    )
  })

  it('approves the target pending account only, once', async () => {
    const neighbour = await newAccount('approve-n')
    const target = await newAccount('approve-t')
    await patchAccount(neighbour.accountId, { approvedAt: null })
    await patchAccount(target.accountId, { approvedAt: null })

    await database.approveAccount({ accountId: target.accountId })
    const approvedAt = (await accountRow(target.accountId)).approvedAt
    expect(approvedAt).toEqual(expect.any(Number))
    expect((await accountRow(neighbour.accountId)).approvedAt).toBeNull()

    // An approved account keeps its original approval time.
    await patchAccount(target.accountId, { approvedAt: new Date(1_000_000) })
    await database.approveAccount({ accountId: target.accountId })
    expect((await accountRow(target.accountId)).approvedAt).toBe(1_000_000)
  })

  it('reads moderation state for the requested actors only', async () => {
    const neighbour = await newAccount('states-n')
    const target = await newAccount('states-t')
    const clean = await newAccount('states-c')
    await database.setActorSuspended({
      actorId: neighbour.actorId,
      suspended: true
    })
    await database.setActorSilenced({ actorId: target.actorId, silenced: true })

    const states = await database.getModerationStatesForActors({
      actorIds: [target.actorId, clean.actorId, target.actorId]
    })
    expect([...states.keys()]).toEqual([target.actorId])
    expect(states.get(target.actorId)).toEqual({
      suspendedAt: null,
      silencedAt: expect.any(Number),
      sensitizedAt: null
    })
    expect(
      await database.getModerationStatesForActors({ actorIds: [] })
    ).toEqual(new Map())
  })
})

describe('rejectPendingAccount', () => {
  const searchDocumentIds = async (actorIds: string[]) =>
    (
      await db()
        .selectFrom('search_documents')
        .select('entityId')
        .where('entityType', '=', 'account')
        .where('entityId', 'in', actorIds)
        .orderBy('entityId')
        .execute()
    ).map((row) => row.entityId)

  it('deletes the pending account and everything it owns, nothing else', async () => {
    const neighbour = await newAccount('reject-n')
    const target = await newAccount('reject-t')
    const secondActorId = await database.createActorForAccount({
      accountId: target.accountId,
      username: `second-${target.username}`,
      domain: DOMAIN,
      privateKey: 'private',
      publicKey: 'public'
    })
    // Both are pending; only the target is rejected.
    await patchAccount(neighbour.accountId, { approvedAt: null })
    await patchAccount(target.accountId, { approvedAt: null })
    await addSession(target.accountId, `reject-t-${target.accountId}`)
    await addSession(neighbour.accountId, `reject-n-${neighbour.accountId}`)

    expect(
      await database.rejectPendingAccount({ accountId: target.accountId })
    ).toBe(true)

    expect(
      await db()
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', target.accountId)
        .executeTakeFirst()
    ).toBeUndefined()
    expect(
      await db()
        .selectFrom('actors')
        .select('id')
        .where('id', 'in', [target.actorId, secondActorId])
        .execute()
    ).toEqual([])
    expect(
      await db()
        .selectFrom('account_providers')
        .select('id')
        .where('accountId', '=', target.accountId)
        .execute()
    ).toEqual([])
    expect(await sessionCount(target.accountId)).toBe(0)
    expect(await searchDocumentIds([target.actorId, secondActorId])).toEqual([])

    // The neighbour keeps its account, actor, provider, session and document.
    expect((await accountRow(neighbour.accountId)).id).toBe(neighbour.accountId)
    expect((await actorRow(neighbour.actorId)).id).toBe(neighbour.actorId)
    expect(
      await db()
        .selectFrom('account_providers')
        .select('id')
        .where('accountId', '=', neighbour.accountId)
        .execute()
    ).toHaveLength(1)
    expect(await sessionCount(neighbour.accountId)).toBe(1)
    expect(await searchDocumentIds([neighbour.actorId])).toEqual([
      neighbour.actorId
    ])
  })

  it('refuses an approved account and keeps it whole', async () => {
    const target = await newAccount('reject-approved')
    expect(
      await database.rejectPendingAccount({ accountId: target.accountId })
    ).toBe(false)
    expect((await actorRow(target.actorId)).id).toBe(target.actorId)
    expect(await database.rejectPendingAccount({ accountId: 'missing' })).toBe(
      false
    )
  })

  it('keeps everything when its final delete fails', async () => {
    const target = await newAccount('reject-fail')
    await patchAccount(target.accountId, { approvedAt: null })
    await addSession(target.accountId, `reject-fail-${target.accountId}`)
    const tables = [
      'accounts',
      'actors',
      'account_providers',
      'sessions',
      'search_documents'
    ] as const
    const dump = async () => {
      const result: Record<string, unknown[]> = {}
      for (const table of tables) {
        result[table] = await db()
          .selectFrom(table)
          .selectAll()
          .orderBy('id')
          .execute()
      }
      return result
    }

    const literal = `'${target.accountId}'`
    if (testDb.backend === 'pg') {
      await sql
        .raw(
          `create or replace function moderation_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
        )
        .execute(db())
      await sql
        .raw(
          `create trigger moderation_queries_fail before delete on accounts for each row when (old.id = ${literal}) execute function moderation_queries_fail()`
        )
        .execute(db())
    } else {
      await sql
        .raw(
          `create trigger moderation_queries_fail before delete on accounts when old.id = ${literal} begin select raise(abort, 'forced failure'); end`
        )
        .execute(db())
    }
    const before = await dump()
    try {
      await expect(
        database.rejectPendingAccount({ accountId: target.accountId })
      ).rejects.toThrow()
    } finally {
      await sql
        .raw(
          testDb.backend === 'pg'
            ? 'drop trigger moderation_queries_fail on accounts'
            : 'drop trigger moderation_queries_fail'
        )
        .execute(db())
    }
    expect(await dump()).toEqual(before)
  })
})

describe('createModerationAction', () => {
  it('stores the returned row', async () => {
    const target = await newAccount('action')
    const action = await database.createModerationAction({
      targetActorId: target.actorId,
      moderatorAccountId: target.accountId,
      action: 'silence',
      text: 'noisy'
    })
    expect(
      await db()
        .selectFrom('moderation_actions')
        .selectAll()
        .where('id', '=', action.id)
        .executeTakeFirstOrThrow()
    ).toEqual(action)
  })
})

describe('deleteAllAccountSessions', () => {
  it('removes the target account sessions only', async () => {
    const neighbour = await newAccount('wipe-n')
    const target = await newAccount('wipe-t')
    await addSession(target.accountId, `wipe-t-1-${target.accountId}`)
    await addSession(target.accountId, `wipe-t-2-${target.accountId}`)
    await addSession(neighbour.accountId, `wipe-n-${neighbour.accountId}`)

    await database.deleteAllAccountSessions({ accountId: target.accountId })

    expect(await sessionCount(target.accountId)).toBe(0)
    expect(await sessionCount(neighbour.accountId)).toBe(1)
  })
})

describe('setReportResolution', () => {
  it('resolves and reopens the target report only', async () => {
    const neighbour = await database.createReport({
      actorId: 'https://test.llun.dev/users/reporter',
      targetActorId: 'https://remote.test/users/other'
    })
    const target = await database.createReport({
      actorId: 'https://test.llun.dev/users/reporter',
      targetActorId: 'https://remote.test/users/spammer'
    })
    const reportRow = (id: string) =>
      db()
        .selectFrom('reports')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    const neighbourBefore = await reportRow(neighbour.id)

    expect(
      await database.setReportResolution({
        reportId: target.id,
        resolved: true,
        actionTakenByActorId: 'https://test.llun.dev/users/mod'
      })
    ).toBe(true)
    expect(await reportRow(target.id)).toMatchObject({
      actionTaken: true,
      actionTakenAt: expect.any(Number),
      actionTakenByActorId: 'https://test.llun.dev/users/mod'
    })
    expect(await reportRow(neighbour.id)).toEqual(neighbourBefore)

    await database.setReportResolution({ reportId: target.id, resolved: false })
    expect(await reportRow(target.id)).toMatchObject({
      actionTaken: false,
      actionTakenAt: null,
      actionTakenByActorId: null
    })
    expect(
      await database.setReportResolution({
        reportId: 'missing',
        resolved: true
      })
    ).toBe(false)
  })
})

describe('admin account records', () => {
  const listIds = async (
    params: Parameters<typeof database.getAdminAccounts>[0]
  ) =>
    (await database.getAdminAccounts({ limit: 1000, ...params })).map(
      (record) => record.actor.id
    )

  it('filters by display name, ip and domain, each against a neighbour', async () => {
    const neighbour = await newAccount('filter-n')
    const target = await newAccount('filter-t')
    const marker = crypto.randomUUID().slice(0, 8)
    await patchActor(target.actorId, { name: `Shown ${marker} Name` })
    await patchActor(neighbour.actorId, { name: 'Someone Else' })
    await addSession(target.accountId, `filter-t-${target.accountId}`, {
      ipAddress: `198.51.100.${marker.charCodeAt(0) % 200}`
    })
    await addSession(neighbour.accountId, `filter-n-${neighbour.accountId}`, {
      ipAddress: '203.0.113.250'
    })
    const remoteDomain = `${marker}.remote.test`
    const remoteId = await newRemoteActor('filter-r', remoteDomain)

    const byName = await listIds({ displayName: `shown ${marker}` })
    expect(byName).toEqual([target.actorId])

    const byIp = await listIds({
      ip: `198.51.100.${marker.charCodeAt(0) % 200}`
    })
    expect(byIp).toContain(target.actorId)
    expect(byIp).not.toContain(neighbour.actorId)

    expect(await listIds({ byDomain: remoteDomain.toUpperCase() })).toEqual([
      remoteId
    ])
    expect(await listIds({ username: target.username.toUpperCase() })).toEqual([
      target.actorId
    ])
    expect(await listIds({ email: target.email.toUpperCase() })).toEqual([
      target.actorId
    ])
  })

  it('keeps exactly the actors each locality and state filter names', async () => {
    // Every actor carries the marker, so the username filter fences the
    // listing to this fixture while each filter under test runs against
    // neighbours in every other state.
    const marker = `st${crypto.randomUUID().slice(0, 6)}`
    const active = await newAccount(`${marker}-active`)
    const suspended = await newAccount(`${marker}-suspended`)
    const silenced = await newAccount(`${marker}-silenced`)
    const sensitized = await newAccount(`${marker}-sensitized`)
    const disabled = await newAccount(`${marker}-disabled`)
    const pending = await newAccount(`${marker}-pending`)
    const staff = await newAccount(`${marker}-staff`)
    const moderator = await newAccount(`${marker}-moderator`)
    await database.setActorSuspended({
      actorId: suspended.actorId,
      suspended: true
    })
    await database.setActorSilenced({
      actorId: silenced.actorId,
      silenced: true
    })
    await database.setActorSensitized({
      actorId: sensitized.actorId,
      sensitized: true
    })
    await database.setAccountDisabled({
      accountId: disabled.accountId,
      disabled: true
    })
    await patchAccount(pending.accountId, { approvedAt: null })
    await patchAccount(staff.accountId, { role: 'admin' })
    await patchAccount(moderator.accountId, { role: 'moderator' })
    const remote = await newRemoteActor(`${marker}-remote`)
    // Account-less on this host: a headless signer, never listed.
    const headlessUsername = `${marker}-headless`
    const headless = `https://${DOMAIN}/users/${headlessUsername}`
    await database.createActor({
      actorId: headless,
      username: headlessUsername,
      domain: DOMAIN,
      followersUrl: `${headless}/followers`,
      inboxUrl: `${headless}/inbox`,
      sharedInboxUrl: `https://${DOMAIN}/inbox`,
      publicKey: 'public',
      createdAt: Date.now()
    })

    const local = [
      active,
      suspended,
      silenced,
      sensitized,
      disabled,
      pending,
      staff,
      moderator
    ].map((account) => account.actorId)
    const list = async (
      params: Parameters<typeof database.getAdminAccounts>[0]
    ) => (await listIds({ username: marker, ...params })).sort()

    expect(await list({})).toEqual([...local, remote].sort())
    expect(await list({ local: true })).toEqual([...local].sort())
    expect(await list({ remote: true })).toEqual([remote])
    expect(await list({ active: true })).toEqual(
      [
        active.actorId,
        sensitized.actorId,
        staff.actorId,
        moderator.actorId
      ].sort()
    )
    expect(await list({ pending: true })).toEqual([pending.actorId])
    expect(await list({ disabled: true })).toEqual([disabled.actorId])
    expect(await list({ silenced: true })).toEqual([silenced.actorId])
    expect(await list({ suspended: true })).toEqual([suspended.actorId])
    expect(await list({ sensitized: true })).toEqual([sensitized.actorId])
    expect(await list({ staff: true })).toEqual([staff.actorId])
  })

  it('pages past actors sharing a createdAt by id', async () => {
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    const accounts = [
      await newAccount('page'),
      await newAccount('page'),
      await newAccount('page')
    ]
    for (const account of accounts) {
      await patchActor(account.actorId, { createdAt })
    }
    const ids = accounts.map((account) => account.actorId).sort()
    // One actor a second older and one a second newer than the tie. The
    // older id sorts after every tied id and the newer one before them, so a
    // cursor that compared ids without the timestamps would misplace both.
    const older = await newAccount('zzz-page-older')
    const newer = await newAccount('aaa-page-newer')
    await patchActor(older.actorId, {
      createdAt: new Date(createdAt.getTime() - 1000)
    })
    await patchActor(newer.actorId, {
      createdAt: new Date(createdAt.getTime() + 1000)
    })
    const fixture = [newer.actorId, ...[...ids].reverse(), older.actorId]
    const page = async (
      params: Parameters<typeof database.getAdminAccounts>[0]
    ) => (await listIds(params)).filter((id) => fixture.includes(id))

    // Newest first: on a tie, the larger id first.
    expect(await page({})).toEqual(fixture)
    expect(await page({ maxId: ids[1] })).toEqual([ids[0], older.actorId])
    expect(await page({ sinceId: ids[1] })).toEqual([newer.actorId, ids[2]])
    expect(await page({ minId: ids[0] })).toEqual([
      newer.actorId,
      ids[2],
      ids[1]
    ])
  })

  it('pairs each actor with its own account', async () => {
    const neighbour = await newAccount('record-n')
    const target = await newAccount('record-t')
    const remoteId = await newRemoteActor('record-r')

    const record = await database.getAdminAccount({ actorId: target.actorId })
    expect(record?.actor.id).toBe(target.actorId)
    expect(record?.account?.id).toBe(target.accountId)
    expect(
      (await database.getAdminAccount({ actorId: remoteId }))?.account
    ).toBeNull()
    expect(await database.getAdminAccount({ actorId: 'missing' })).toBeNull()

    const records = await database.getAdminAccountRecords({
      actorIds: [target.actorId, remoteId, target.actorId]
    })
    expect(
      records.map((item) => [item.actor.id, item.account?.id ?? null]).sort()
    ).toEqual(
      [
        [target.actorId, target.accountId],
        [remoteId, null]
      ].sort()
    )
    expect(records.map((item) => item.actor.id)).not.toContain(
      neighbour.actorId
    )
    expect(await database.getAdminAccountRecords({ actorIds: [] })).toEqual([])

    const listed = (await database.getAdminAccounts({ limit: 1000 })).find(
      (item) => item.actor.id === target.actorId
    )
    expect(listed?.account?.id).toBe(target.accountId)
  })

  it('reads the latest-first session ips of the requested accounts only', async () => {
    const neighbour = await newAccount('ips-n')
    const target = await newAccount('ips-t')
    await addSession(target.accountId, `ips-t-old-${target.accountId}`, {
      ipAddress: '192.0.2.1',
      updatedAt: new Date(1_000_000)
    })
    await addSession(target.accountId, `ips-t-new-${target.accountId}`, {
      ipAddress: '192.0.2.2',
      updatedAt: new Date(2_000_000)
    })
    await addSession(target.accountId, `ips-t-again-${target.accountId}`, {
      ipAddress: '192.0.2.1',
      updatedAt: new Date(1_500_000)
    })
    // No ip recorded: not an entry.
    await addSession(target.accountId, `ips-t-none-${target.accountId}`)
    await addSession(neighbour.accountId, `ips-n-${neighbour.accountId}`, {
      ipAddress: '192.0.2.9'
    })

    const ips = await database.getSessionIpsForAccounts({
      accountIds: [target.accountId]
    })
    expect([...ips.keys()]).toEqual([target.accountId])
    expect(ips.get(target.accountId)).toEqual([
      { ip: '192.0.2.2', usedAt: 2_000_000 },
      { ip: '192.0.2.1', usedAt: 1_500_000 }
    ])
    expect(await database.getSessionIpsForAccounts({ accountIds: [] })).toEqual(
      new Map()
    )
  })
})

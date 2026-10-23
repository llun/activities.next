import crypto from 'crypto'
import { type Insertable, sql } from 'kysely'

import type { SQLActorDatabase } from '@/lib/database/domains/actor/types'
import type { Actors } from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { holdTransaction } from '@/lib/database/testing/heldTransaction'
import { CounterKey } from '@/lib/database/utils/counter'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { DEFAULT_NOTIFICATION_POLICY } from '@/lib/types/database/operations'

// Every `where`, join, `orderBy` and `limit` in the actor lookups and writes,
// each pinned with a neighbouring row the query must not touch, plus the
// transactions of createActor, updateActor, deleteActor and the deletion state
// changes rolling back as a whole when their last write fails, and the row
// lock of updateActor's accepted-senders merge on PostgreSQL. The Mastodon
// view, the directory, the federation signer and NodeInfo are in
// actorMastodonQueries.test.ts. Runs on PostgreSQL in CI.

// The configured host (test/setup/vitest.setup.ts): emoji tags resolve only for
// actors on it.
const LOCAL = TEST_DOMAIN
const REMOTE = 'actorq.remote.test'

const testDb = createTestDatabase()
// getMastodonActor(s) are on the SQL facade, not the Database interface.
const database = testDb.database as typeof testDb.database & SQLActorDatabase
const db = () => testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

const suffix = () => crypto.randomUUID().slice(0, 8)

const settingsFor = (id: string, domain: string) => ({
  followersUrl: `${id}/followers`,
  inboxUrl: `${id}/inbox`,
  sharedInboxUrl: `https://${domain}/inbox`
})

// Writes an actor row as given, so a test controls every column.
const insertActor = async (
  label: string,
  values: Partial<Insertable<Actors>> = {}
) => {
  const username = values.username ?? `${label}-${suffix()}`
  const domain = values.domain ?? REMOTE
  const id = values.id ?? `https://${domain}/users/${username}`
  await db()
    .insertInto('actors')
    .values({
      id,
      publicId: `${suffix()}-${suffix()}`,
      type: 'Person',
      username,
      domain,
      accountId: null,
      settings: JSON.stringify(settingsFor(id, domain)),
      publicKey: `public-${username}`,
      privateKey: null,
      createdAt: new Date(1_000_000),
      updatedAt: new Date(1_000_000),
      ...values
    })
    .execute()
  return id
}

const insertAccount = async (label: string, email?: string) => {
  const id = crypto.randomUUID()
  await db()
    .insertInto('accounts')
    .values({
      id,
      email: email ?? `${label}-${suffix()}@actorq.test`,
      passwordHash: 'hash',
      createdAt: new Date(2_000_000),
      updatedAt: new Date(2_000_000)
    })
    .execute()
  return id
}

const setCounter = (id: string, value: number) =>
  db()
    .insertInto('counters')
    .values({ id, value, createdAt: new Date(), updatedAt: new Date() })
    .onConflict((oc) => oc.column('id').doUpdateSet({ value }))
    .execute()

const counterValue = async (id: string) =>
  (
    await db()
      .selectFrom('counters')
      .select('value')
      .where('id', '=', id)
      .executeTakeFirst()
  )?.value

const actorRow = (id: string) =>
  db()
    .selectFrom('actors')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const searchDocument = (actorId: string) =>
  db()
    .selectFrom('search_documents')
    .selectAll()
    .where('entityType', '=', 'account')
    .where('entityId', '=', actorId)
    .executeTakeFirst()

const insertFollow = (actorId: string, targetActorId: string, status: string) =>
  db()
    .insertInto('follows')
    .values({
      id: crypto.randomUUID(),
      actorId,
      targetActorId,
      status,
      inbox: `${actorId}/inbox`,
      sharedInbox: `${actorId}/inbox`,
      actorHost: REMOTE,
      targetActorHost: REMOTE
    })
    .execute()

const createRemoteActor = (label: string, extra: object = {}) => {
  const username = `${label}-${suffix()}`
  const actorId = `https://${REMOTE}/users/${username}`
  return {
    actorId,
    params: {
      actorId,
      username,
      domain: REMOTE,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${REMOTE}/inbox`,
      publicKey: `public-${username}`,
      createdAt: 3_000_000,
      ...extra
    }
  }
}

describe('getActorFromId', () => {
  it('reads the requested actor with its own counters', async () => {
    const neighbour = await insertActor('id-n')
    const target = await insertActor('id-t', { lastStatusAt: new Date(7000) })
    await setCounter(CounterKey.totalFollowers(target), 3)
    await setCounter(CounterKey.totalFollowing(target), 5)
    await setCounter(CounterKey.totalStatus(target), 7)
    await setCounter(CounterKey.totalFollowers(neighbour), 100)

    const actor = await database.getActorFromId({ id: target })
    expect(actor).toMatchObject({
      id: target,
      followersCount: 3,
      followingCount: 5,
      statusCount: 7,
      lastStatusAt: 7000
    })
    expect(actor?.account).toBeUndefined()
    expect((await database.getActorFromId({ id: neighbour }))?.id).toBe(
      neighbour
    )
    expect(await database.getActorFromId({ id: `${target}-missing` })).toBe(
      null
    )
  })

  it('attaches its own account, not a neighbouring one', async () => {
    const neighbourAccount = await insertAccount('id-acct-n')
    const accountId = await insertAccount('id-acct-t')
    await insertActor('id-acct-n', { accountId: neighbourAccount })
    const target = await insertActor('id-acct-t', { accountId })
    await setCounter(CounterKey.totalStatus(target), 2)

    const actor = await database.getActorFromId({ id: target })
    expect(actor?.account?.id).toBe(accountId)
    expect(actor?.statusCount).toBe(2)
  })
})

describe('getActorFromEmail', () => {
  it('finds the actor of the account with that e-mail only', async () => {
    const email = `email-t-${suffix()}@actorq.test`
    const neighbourAccount = await insertAccount('email-n')
    const accountId = await insertAccount('email-t', email)
    await insertActor('email-n', { accountId: neighbourAccount })
    const target = await insertActor('email-t', { accountId })
    // An actor whose id matches nothing joined: no account, no e-mail.
    await insertActor('email-none')

    const actor = await database.getActorFromEmail({ email })
    expect(actor?.id).toBe(target)
    expect(actor?.account?.email).toBe(email)
    expect(
      await database.getActorFromEmail({ email: `missing-${email}` })
    ).toBeNull()
  })
})

describe('getActorFromUsername', () => {
  it('prefers the exact spelling, then the oldest folded match, on its own domain', async () => {
    const domain = `fold-${suffix()}.test`
    const lower = await insertActor('fold', {
      username: 'casey',
      domain,
      createdAt: new Date(1000)
    })
    const upper = await insertActor('fold', {
      username: 'Casey',
      domain,
      createdAt: new Date(2000)
    })
    const later = await insertActor('fold', {
      username: 'CASEY',
      domain,
      createdAt: new Date(3000)
    })
    await insertActor('fold', {
      username: 'cAsEy',
      domain: `other-${domain}`,
      createdAt: new Date(500)
    })

    const lookup = async (username: string, lookupDomain = domain) =>
      (await database.getActorFromUsername({ username, domain: lookupDomain }))
        ?.id
    expect(await lookup('Casey')).toBe(upper)
    expect(await lookup('CASEY')).toBe(later)
    expect(await lookup('caSEY')).toBe(lower)
    expect(await lookup('casey', `none-${domain}`)).toBeUndefined()
  })

  it('attaches the account of a local actor', async () => {
    const accountId = await insertAccount('uname-acct')
    const username = `uname-${suffix()}`
    await insertActor('uname', { username, domain: LOCAL, accountId })
    const actor = await database.getActorFromUsername({
      username,
      domain: LOCAL
    })
    expect(actor?.account?.id).toBe(accountId)
  })
})

describe('getActorsFromIds', () => {
  it('returns the requested actors once each, in request order, with their own accounts and counters', async () => {
    const accountA = await insertAccount('ids-a')
    const a = await insertActor('ids-a', { accountId: accountA })
    const b = await insertActor('ids-b')
    const neighbour = await insertActor('ids-n')
    await setCounter(CounterKey.totalFollowers(a), 4)
    await setCounter(CounterKey.totalFollowing(b), 6)
    await setCounter(CounterKey.totalStatus(neighbour), 9)

    const actors = await database.getActorsFromIds({
      ids: [b, `${b}-missing`, a, b]
    })
    expect(actors.map((actor) => actor.id)).toEqual([b, a])
    expect(actors[0]).toMatchObject({ followingCount: 6, statusCount: 0 })
    expect(actors[0].account).toBeUndefined()
    expect(actors[1]).toMatchObject({ followersCount: 4 })
    expect(actors[1].account?.id).toBe(accountA)
    expect(await database.getActorsFromIds({ ids: [] })).toEqual([])
  })
})

describe('publicId lookups', () => {
  it('resolves a publicId case-insensitively to its own actor', async () => {
    const publicId = `abcd${suffix()}-pub`
    const target = await insertActor('pub-t', { publicId })
    await insertActor('pub-n')

    expect(
      await database.getActorIdByPublicId({ publicId: publicId.toUpperCase() })
    ).toBe(target)
    expect(
      await database.getActorIdByPublicId({ publicId: `${publicId}-x` })
    ).toBeNull()
  })

  it('maps the requested publicIds, keyed as requested', async () => {
    const first = `aa${suffix()}-pub`
    const second = `bb${suffix()}-pub`
    const a = await insertActor('pubs-a', { publicId: first })
    const b = await insertActor('pubs-b', { publicId: second })
    await insertActor('pubs-n')

    const resolved = await database.getActorIdsByPublicIds({
      publicIds: [first.toUpperCase(), second, `${second}-x`]
    })
    expect(Object.fromEntries(resolved)).toEqual({
      [first.toUpperCase()]: a,
      [second]: b
    })
  })

  it('maps actor ids to their publicIds, leaving out an actor without one', async () => {
    const publicId = `cc${suffix()}-pub`
    const a = await insertActor('ids-pub', { publicId })
    const noPublicId = await insertActor('ids-nopub', { publicId: null })
    await insertActor('ids-pub-n')

    const resolved = await database.getActorPublicIds({
      actorIds: [a, noPublicId, `${a}-missing`]
    })
    expect(Object.fromEntries(resolved)).toEqual({ [a]: publicId })
  })
})

describe('isCurrentActorFollowing', () => {
  it('is true only for an accepted follow in that direction', async () => {
    const follower = await insertActor('fol-a')
    const target = await insertActor('fol-b')
    const requested = await insertActor('fol-c')
    const other = await insertActor('fol-d')
    await insertFollow(follower, target, 'Accepted')
    await insertFollow(follower, requested, 'Requested')
    await insertFollow(other, follower, 'Accepted')

    const follows = (currentActorId: string, followingActorId: string) =>
      database.isCurrentActorFollowing({ currentActorId, followingActorId })
    expect(await follows(follower, target)).toBe(true)
    expect(await follows(target, follower)).toBe(false)
    expect(await follows(follower, requested)).toBe(false)
    expect(await follows(follower, other)).toBe(false)
    expect(await follows(other, target)).toBe(false)
  })
})

describe('settings and notification policy', () => {
  it('reads the settings of the requested actor only', async () => {
    const target = await insertActor('set-t', {
      settings: JSON.stringify({ ...settingsFor('t', REMOTE), bot: true })
    })
    await insertActor('set-n', {
      settings: JSON.stringify({ ...settingsFor('n', REMOTE), bot: false })
    })
    expect(await database.getActorSettings({ actorId: target })).toMatchObject({
      bot: true
    })
    expect(
      await database.getActorSettings({ actorId: `${target}-missing` })
    ).toBeUndefined()
  })

  it('fills the policy with the defaults and updates it through updateActor', async () => {
    const target = await insertActor('pol-t')
    const neighbour = await insertActor('pol-n')
    expect(await database.getNotificationPolicy({ actorId: target })).toEqual(
      DEFAULT_NOTIFICATION_POLICY
    )

    const updated = await database.updateNotificationPolicy({
      actorId: target,
      for_not_following: 'filter'
    })
    expect(updated).toEqual({
      ...DEFAULT_NOTIFICATION_POLICY,
      for_not_following: 'filter'
    })
    expect(await database.getNotificationPolicy({ actorId: target })).toEqual(
      updated
    )
    expect(
      await database.getNotificationPolicy({ actorId: neighbour })
    ).toEqual(DEFAULT_NOTIFICATION_POLICY)
  })
})

describe('counters', () => {
  it('reads following and followers from their own keys', async () => {
    const target = await insertActor('cnt-t')
    const neighbour = await insertActor('cnt-n')
    await setCounter(CounterKey.totalFollowing(target), 11)
    await setCounter(CounterKey.totalFollowers(target), 13)
    await setCounter(CounterKey.totalFollowing(neighbour), 99)
    expect(await database.getActorFollowingCount({ actorId: target })).toBe(11)
    expect(await database.getActorFollowersCount({ actorId: target })).toBe(13)
  })

  it('setActorCounters overwrites the given counts, keeps the rest and stamps the sync marker', async () => {
    const target = await insertActor('sync-t')
    const neighbour = await insertActor('sync-n')
    await setCounter(CounterKey.totalFollowers(target), 50)
    await setCounter(CounterKey.totalFollowing(target), 60)
    await setCounter(CounterKey.totalStatus(target), 70)
    expect(await database.hasActorCounters({ actorId: target })).toBe(false)

    const before = Math.floor(Date.now() / 1000)
    await database.setActorCounters({
      actorId: target,
      followersCount: 0,
      followingCount: null,
      statusCount: 21
    })
    const after = Math.floor(Date.now() / 1000)

    expect(await counterValue(CounterKey.totalFollowers(target))).toBe(0)
    expect(await counterValue(CounterKey.totalFollowing(target))).toBe(60)
    expect(await counterValue(CounterKey.totalStatus(target))).toBe(21)
    const marker = await counterValue(CounterKey.remoteCountsSyncedAt(target))
    expect(marker).toBeGreaterThanOrEqual(before)
    expect(marker).toBeLessThanOrEqual(after)
    expect(await database.hasActorCounters({ actorId: target })).toBe(true)
    expect(await database.hasActorCounters({ actorId: neighbour })).toBe(false)
    expect(
      await counterValue(CounterKey.remoteCountsSyncedAt(neighbour))
    ).toBeUndefined()

    // A second sync creates the missing following row and leaves followers.
    await database.setActorCounters({
      actorId: neighbour,
      followingCount: 8
    })
    expect(await counterValue(CounterKey.totalFollowing(neighbour))).toBe(8)
    expect(
      await counterValue(CounterKey.totalFollowers(neighbour))
    ).toBeUndefined()
  })
})

describe('deletion state', () => {
  it('schedules, starts and cancels the requested actor only', async () => {
    const target = await insertActor('del-t')
    const neighbour = await insertActor('del-n')
    const scheduledAt = new Date('2030-01-02T03:04:05.000Z')

    await database.scheduleActorDeletion({ actorId: target, scheduledAt })
    expect(await database.getActorDeletionStatus({ id: target })).toEqual({
      status: 'scheduled',
      scheduledAt: scheduledAt.getTime()
    })
    expect(await database.getActorDeletionStatus({ id: neighbour })).toEqual({
      status: null,
      scheduledAt: null
    })
    expect(
      await database.getActorDeletionStatus({ id: `${target}-missing` })
    ).toBeUndefined()

    await database.startActorDeletion({ actorId: target })
    expect(await database.getActorDeletionStatus({ id: target })).toEqual({
      status: 'deleting',
      scheduledAt: scheduledAt.getTime()
    })

    await database.cancelActorDeletion({ actorId: target })
    expect(await database.getActorDeletionStatus({ id: target })).toEqual({
      status: null,
      scheduledAt: null
    })
    expect((await actorRow(neighbour)).updatedAt).toBe(1_000_000)
    expect((await actorRow(target)).updatedAt).toBeGreaterThan(1_000_000)
  })

  it('takes the actor out of account search while a deletion is pending', async () => {
    const { actorId, params } = createRemoteActor('del-search')
    await database.createActor(params)
    expect((await searchDocument(actorId))?.discoverable).toBe(true)

    await database.scheduleActorDeletion({ actorId, scheduledAt: null })
    expect((await searchDocument(actorId))?.discoverable).toBe(false)
    await database.cancelActorDeletion({ actorId })
    expect((await searchDocument(actorId))?.discoverable).toBe(true)
    await database.startActorDeletion({ actorId })
    expect((await searchDocument(actorId))?.discoverable).toBe(false)
  })

  it('lists the actors scheduled at or before the date, and no other', async () => {
    const at = Date.parse('2031-05-05T00:00:00.000Z')
    const due = await insertActor('due', {
      deletionStatus: 'scheduled',
      deletionScheduledAt: new Date(at - 1000)
    })
    const boundary = await insertActor('due-edge', {
      deletionStatus: 'scheduled',
      deletionScheduledAt: new Date(at)
    })
    await insertActor('due-later', {
      deletionStatus: 'scheduled',
      deletionScheduledAt: new Date(at + 1000)
    })
    await insertActor('due-deleting', {
      deletionStatus: 'deleting',
      deletionScheduledAt: new Date(at - 1000)
    })
    await insertActor('due-none', { deletionScheduledAt: new Date(at - 1000) })

    const actors = await database.getActorsScheduledForDeletion({
      beforeDate: new Date(at)
    })
    const ids = actors.map((actor) => actor.id)
    expect(ids).toEqual(expect.arrayContaining([due, boundary]))
    expect(ids.filter((id) => id.includes('/due-')).sort()).toEqual(
      [due, boundary].sort()
    )
  })
})

describe('createActor', () => {
  it('writes the row, its settings and its search document', async () => {
    const { actorId, params } = createRemoteActor('create', {
      type: 'Service',
      name: 'Created :wave:',
      summary: 'About',
      iconUrl: 'https://img.test/icon.png',
      manuallyApprovesFollowers: false,
      fields: [{ name: 'Site', value: 'https://site.test' }],
      privateKey: 'private'
    })
    const actor = await database.createActor(params)

    expect(actor).toMatchObject({
      id: actorId,
      type: 'Service',
      name: 'Created :wave:',
      summary: 'About',
      iconUrl: 'https://img.test/icon.png',
      manuallyApprovesFollowers: false,
      privateKey: 'private',
      createdAt: 3_000_000,
      followersCount: 0,
      deletionStatus: null
    })
    // No tags: none were passed and no emoji is named. That a remote actor's
    // text is never resolved against this instance's emojis is pinned with a
    // seeded emoji in the emoji test below.
    expect(actor?.tags).toBeUndefined()
    const row = await actorRow(actorId)
    expect(row.settings).toEqual({
      ...settingsFor(actorId, REMOTE),
      iconUrl: 'https://img.test/icon.png',
      manuallyApprovesFollowers: false,
      fields: [{ name: 'Site', value: 'https://site.test' }]
    })
    expect(row.publicId).toEqual(expect.any(String))
    expect(await searchDocument(actorId)).toMatchObject({
      actorId,
      discoverable: true,
      entityCreatedAt: 3_000_000
    })
  })

  it("resolves a local actor's enabled emojis only", async () => {
    const enabled = `en${suffix().replaceAll('-', '')}`
    const disabled = `dis${suffix().replaceAll('-', '')}`
    await db()
      .insertInto('customEmojis')
      .values([
        {
          id: crypto.randomUUID(),
          shortcode: enabled,
          url: `https://img.test/${enabled}.png`,
          staticUrl: `https://img.test/${enabled}.png`,
          disabled: false
        },
        {
          id: crypto.randomUUID(),
          shortcode: disabled,
          url: `https://img.test/${disabled}.png`,
          staticUrl: `https://img.test/${disabled}.png`,
          disabled: true
        }
      ])
      .execute()

    const username = `emoji-${suffix()}`
    const actorId = `https://${LOCAL}/users/${username}`
    const actor = await database.createActor({
      actorId,
      username,
      domain: LOCAL,
      name: `Name :${enabled}: :${disabled}:`,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${LOCAL}/inbox`,
      publicKey: 'public',
      createdAt: 3_000_000
    })
    expect(actor?.tags).toEqual([
      {
        type: 'emoji',
        name: `:${enabled}:`,
        value: `https://img.test/${enabled}.png`
      }
    ])

    // updateActor re-resolves them from the new profile text.
    const updated = await database.updateActor({
      actorId,
      summary: `Now :${disabled}: only`
    })
    expect(updated?.tags).toEqual([
      {
        type: 'emoji',
        name: `:${enabled}:`,
        value: `https://img.test/${enabled}.png`
      }
    ])
    const renamed = await database.updateActor({ actorId, name: 'Plain' })
    expect(renamed?.tags).toEqual([])

    // A remote actor naming the very same enabled emoji gets no tag from this
    // instance, whether it is created or updated: its tags are what its own
    // instance sent. Local and remote differ only by the domain.
    const remote = createRemoteActor('emoji-remote', {
      name: `Remote :${enabled}:`,
      summary: `About :${enabled}:`,
      fields: [{ name: 'Emoji', value: `:${enabled}:` }]
    })
    const remoteCreated = await database.createActor(remote.params)
    expect(remoteCreated?.name).toBe(`Remote :${enabled}:`)
    expect(remoteCreated?.tags).toBeUndefined()
    expect(await actorRow(remote.actorId)).toMatchObject({
      settings: { fields: [{ name: 'Emoji', value: `:${enabled}:` }] }
    })
    expect((await actorRow(remote.actorId)).settings).not.toHaveProperty('tags')

    const quiet = createRemoteActor('emoji-quiet', { name: 'Quiet' })
    await database.createActor(quiet.params)
    const quietUpdated = await database.updateActor({
      actorId: quiet.actorId,
      summary: `Now :${enabled}:`
    })
    expect(quietUpdated?.summary).toBe(`Now :${enabled}:`)
    expect(quietUpdated?.tags).toBeUndefined()
    expect((await actorRow(quiet.actorId)).settings).not.toHaveProperty('tags')

    // Tags a remote actor already carries survive an update of its text.
    const sent = [
      {
        type: 'emoji' as const,
        name: ':sent:',
        value: 'https://remote.test/sent.png'
      }
    ]
    const tagged = createRemoteActor('emoji-tagged', { tags: sent })
    await database.createActor(tagged.params)
    const taggedUpdated = await database.updateActor({
      actorId: tagged.actorId,
      name: `Tagged :${enabled}:`
    })
    expect(taggedUpdated?.tags).toEqual(sent)
  })

  it('stores no tags key when no emoji is resolved, as before', async () => {
    const username = `no-emoji-${suffix()}`
    const actorId = `https://${LOCAL}/users/${username}`
    const params = {
      actorId,
      username,
      domain: LOCAL,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${LOCAL}/inbox`,
      publicKey: 'public',
      createdAt: 3_000_000
    }

    // The text names a shortcode that is no emoji of this instance.
    const unresolved = await database.createActor({
      ...params,
      name: 'Plain :nosuchemoji:'
    })
    expect(unresolved?.tags).toBeUndefined()
    expect(unresolved?.name).toBe('Plain :nosuchemoji:')
    expect((await actorRow(actorId)).settings).not.toHaveProperty('tags')

    // An explicit empty list is dropped the same way.
    const remote = createRemoteActor('no-emoji-empty', { tags: [] })
    const explicit = await database.createActor(remote.params)
    expect(explicit?.tags).toBeUndefined()
    expect((await actorRow(remote.actorId)).settings).not.toHaveProperty('tags')

    // An update, in contrast, stores an explicit empty list: it clears the
    // tags the actor had.
    const sent = [
      {
        type: 'emoji' as const,
        name: ':sent:',
        value: 'https://remote.test/sent.png'
      }
    ]
    const tagged = createRemoteActor('no-emoji-clear', { tags: sent })
    expect((await database.createActor(tagged.params))?.tags).toEqual(sent)
    const cleared = await database.updateActor({
      actorId: tagged.actorId,
      tags: []
    })
    expect(cleared?.tags).toEqual([])
    expect((await actorRow(tagged.actorId)).settings).toMatchObject({
      tags: []
    })
  })
})

describe('updateActor', () => {
  it('updates the requested actor only, and re-indexes it', async () => {
    const target = await insertActor('upd-t', { name: 'Old', summary: 'Old' })
    const neighbour = await insertActor('upd-n', { name: 'Old' })
    const neighbourBefore = await actorRow(neighbour)

    const actor = await database.updateActor({
      actorId: target,
      type: 'Group',
      name: 'New name',
      summary: 'New summary',
      publicKey: 'new-public',
      iconUrl: 'https://img.test/new.png',
      bot: true,
      navOrder: ['home']
    })
    expect(actor).toMatchObject({
      id: target,
      type: 'Group',
      name: 'New name',
      summary: 'New summary',
      publicKey: 'new-public',
      iconUrl: 'https://img.test/new.png'
    })
    expect((await actorRow(target)).settings).toMatchObject({
      bot: true,
      navOrder: ['home'],
      iconUrl: 'https://img.test/new.png'
    })
    expect(await actorRow(neighbour)).toEqual(neighbourBefore)
    expect((await searchDocument(target))?.documentText).toContain('New name')
    expect(await database.updateActor({ actorId: `${target}-x` })).toBeNull()
  })

  it('clears an icon and a header given as null and keeps them when undefined', async () => {
    const target = await insertActor('upd-clear', {
      settings: JSON.stringify({
        ...settingsFor('c', REMOTE),
        iconUrl: 'https://img.test/i.png',
        headerImageUrl: 'https://img.test/h.png'
      })
    })
    await database.updateActor({ actorId: target, headerImageUrl: null })
    expect((await actorRow(target)).settings).toMatchObject({
      iconUrl: 'https://img.test/i.png'
    })
    expect(
      (await actorRow(target)).settings as Record<string, unknown>
    ).not.toHaveProperty('headerImageUrl')
  })

  it('merges appended accepted senders into the stored list', async () => {
    const target = await insertActor('upd-append', {
      settings: JSON.stringify({
        ...settingsFor('a', REMOTE),
        notificationAcceptedSenders: ['one'],
        bot: true
      })
    })
    await database.updateActor({
      actorId: target,
      appendNotificationAcceptedSenders: ['one', 'two'],
      discoverable: false
    })
    expect((await actorRow(target)).settings).toMatchObject({
      notificationAcceptedSenders: ['one', 'two'],
      bot: true,
      discoverable: false
    })
  })

  it('still clears an icon given as null when it appends accepted senders', async () => {
    const target = await insertActor('upd-append-clear', {
      settings: JSON.stringify({
        ...settingsFor('ac', REMOTE),
        iconUrl: 'https://img.test/i.png',
        headerImageUrl: 'https://img.test/h.png',
        notificationAcceptedSenders: ['one']
      })
    })
    const actor = await database.updateActor({
      actorId: target,
      iconUrl: null,
      appendNotificationAcceptedSenders: ['two']
    })
    // The merge starts from the locked row, then re-applies this call's own
    // clears: the icon goes, the untouched header stays.
    const settings = (await actorRow(target)).settings as Record<
      string,
      unknown
    >
    expect(settings).not.toHaveProperty('iconUrl')
    expect(settings).toMatchObject({
      headerImageUrl: 'https://img.test/h.png',
      notificationAcceptedSenders: ['one', 'two']
    })
    expect(actor?.iconUrl).toBeUndefined()
  })

  it('clears a name and a summary given as an empty string', async () => {
    const target = await insertActor('upd-empty', {
      name: 'Old name',
      summary: 'Old summary'
    })
    await database.updateActor({
      actorId: target,
      name: '',
      summary: '',
      bot: true
    })
    expect(await actorRow(target)).toMatchObject({
      name: '',
      summary: '',
      settings: { bot: true }
    })
    expect((await searchDocument(target))?.documentText ?? '').not.toContain(
      'Old name'
    )
  })

  it('keeps a name and a summary left out of the update', async () => {
    const target = await insertActor('upd-absent', {
      name: 'Old name',
      summary: 'Old summary'
    })
    await database.updateActor({ actorId: target, bot: true })
    expect(await actorRow(target)).toMatchObject({
      name: 'Old name',
      summary: 'Old summary'
    })
  })
})

describe('deleteActor', () => {
  it('deletes the requested actor and its search document only', async () => {
    const target = createRemoteActor('rm-t')
    const neighbour = createRemoteActor('rm-n')
    await database.createActor(target.params)
    await database.createActor(neighbour.params)

    await database.deleteActor({ actorId: target.actorId })
    expect(await database.getActorFromId({ id: target.actorId })).toBeNull()
    expect(await searchDocument(target.actorId)).toBeUndefined()
    expect((await database.getActorFromId({ id: neighbour.actorId }))?.id).toBe(
      neighbour.actorId
    )
    expect(await searchDocument(neighbour.actorId)).toBeDefined()
  })
})

describe('legacy rows', () => {
  it('reads an epoch-0 timestamp as set, on both backends', async () => {
    const accountId = await insertAccount('epoch')
    await db()
      .updateTable('accounts')
      .set({ verifiedAt: new Date(0), approvedAt: new Date(0) })
      .where('id', '=', accountId)
      .execute()
    const target = await insertActor('epoch', {
      accountId,
      suspendedAt: new Date(0),
      silencedAt: new Date(0),
      sensitizedAt: new Date(0),
      deletionScheduledAt: new Date(0)
    })
    expect(await database.getActorFromId({ id: target })).toMatchObject({
      suspendedAt: 0,
      silencedAt: 0,
      sensitizedAt: 0,
      deletionScheduledAt: 0,
      account: { verifiedAt: 0, approvedAt: 0 }
    })
    expect(await database.getActorDeletionStatus({ id: target })).toEqual({
      status: null,
      scheduledAt: 0
    })
    expect(await database.getMastodonActor(target)).toMatchObject({
      suspended: true,
      limited: true
    })
  })

  it('reads settings holding JSON null, or a JSON-encoded string, as their content', async () => {
    const nullSettings = await insertActor('json-null', { settings: 'null' })
    const encoded = await insertActor('json-encoded', {
      settings: JSON.stringify(
        JSON.stringify({ ...settingsFor('e', REMOTE), iconUrl: 'https://i' })
      )
    })
    // No inbox or followers URL: the domain Actor refuses it, the Mastodon
    // Account reads it with every default.
    await expect(
      database.getActorFromId({ id: nullSettings })
    ).rejects.toMatchObject({ name: 'ZodError' })
    expect(await database.getMastodonActor(nullSettings)).toMatchObject({
      url: nullSettings,
      avatar: '',
      locked: true
    })
    expect(await database.getActorSettings({ actorId: nullSettings })).toEqual(
      {}
    )
    expect((await database.getActorFromId({ id: encoded }))?.iconUrl).toBe(
      'https://i'
    )
    expect(await database.getActorSettings({ actorId: encoded })).toMatchObject(
      { iconUrl: 'https://i' }
    )
  })
})

// Forces the next matching write on `table` to fail with a database error.
// Returns the function that removes the trigger again.
const failWrite = async (
  table: string,
  event: 'insert' | 'delete',
  column: string,
  value: string
) => {
  const name = `actor_queries_fail_${event}_${table}`.toLowerCase()
  const record = event === 'insert' ? 'new' : 'old'
  const literal = `'${value.replaceAll("'", "''")}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function actor_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db())
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${record}."${column}" = ${literal}) execute function actor_queries_fail()`
      )
      .execute(db())
    return () => sql.raw(`drop trigger ${name} on "${table}"`).execute(db())
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${record}."${column}" = ${literal} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db())
  return () => sql.raw(`drop trigger ${name}`).execute(db())
}

const TABLES = ['actors', 'counters', 'search_documents'] as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    dump[table] = await db()
      .selectFrom(table)
      .selectAll()
      .orderBy('id')
      .execute()
  }
  return dump
}

describe('transactions', () => {
  const expectRollback = async (
    write: () => Promise<unknown>,
    fail: Parameters<typeof failWrite>
  ) => {
    const drop = await failWrite(...fail)
    const before = await dumpTables()
    try {
      await expect(write()).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  }

  it('createActor keeps nothing when its search document write fails', async () => {
    const { actorId, params } = createRemoteActor('tx-create')
    await expectRollback(
      () => database.createActor(params),
      ['search_documents', 'insert', 'entityId', actorId]
    )
  })

  it('updateActor keeps the row when its search document write fails', async () => {
    const target = await insertActor('tx-update')
    await expectRollback(
      () =>
        database.updateActor({
          actorId: target,
          name: 'Never',
          appendNotificationAcceptedSenders: ['never']
        }),
      ['search_documents', 'insert', 'entityId', target]
    )
  })

  it('deleteActor keeps the row when its search document delete fails', async () => {
    const { actorId, params } = createRemoteActor('tx-delete')
    await database.createActor(params)
    await expectRollback(
      () => database.deleteActor({ actorId }),
      ['search_documents', 'delete', 'entityId', actorId]
    )
  })

  it.each([
    [
      'scheduleActorDeletion',
      (actorId: string) =>
        database.scheduleActorDeletion({
          actorId,
          scheduledAt: new Date('2030-01-01T00:00:00.000Z')
        })
    ],
    [
      'startActorDeletion',
      (actorId: string) => database.startActorDeletion({ actorId })
    ]
  ])(
    '%s keeps the deletion state when its search document write fails',
    async (_, write) => {
      const { actorId, params } = createRemoteActor('tx-state')
      await database.createActor(params)
      await expectRollback(
        () => write(actorId),
        ['search_documents', 'insert', 'entityId', actorId]
      )
    }
  )

  it('cancelActorDeletion keeps the deletion state when its search document delete fails', async () => {
    const { actorId, params } = createRemoteActor('tx-cancel')
    await database.createActor(params)
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })
    // A pending deletion keeps the document, marked not discoverable, so the
    // cancel re-index is an upsert.
    await expectRollback(
      () => database.cancelActorDeletion({ actorId }),
      ['search_documents', 'insert', 'entityId', actorId]
    )
  })
})

describe.runIf(testDb.backend === 'pg')('updateActor row lock', () => {
  const waitForLockWait = async () => {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const { rows } = await sql<{ waiting: number }>`
        select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'
      `.execute(db())
      if (rows[0].waiting > 0) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('updateActor never waited for the actor row')
  }

  it('merges accepted senders committed while it waits for the row', async () => {
    const target = await insertActor('lock', {
      settings: JSON.stringify({
        ...settingsFor('l', REMOTE),
        notificationAcceptedSenders: ['first']
      })
    })

    const { trx, commit, rollback } = await holdTransaction(db())
    let update: Promise<unknown> | undefined
    try {
      await trx
        .selectFrom('actors')
        .selectAll()
        .where('id', '=', target)
        .forUpdate()
        .executeTakeFirst()
      update = database.updateActor({
        actorId: target,
        appendNotificationAcceptedSenders: ['third']
      })
      await waitForLockWait()
      await trx
        .updateTable('actors')
        .set({
          settings: JSON.stringify({
            ...settingsFor('l', REMOTE),
            notificationAcceptedSenders: ['first', 'second']
          })
        })
        .where('id', '=', target)
        .execute()
      await commit()
    } catch (error) {
      await rollback()
      throw error
    }
    await update

    expect((await actorRow(target)).settings).toMatchObject({
      notificationAcceptedSenders: ['first', 'second', 'third']
    })
  })
})

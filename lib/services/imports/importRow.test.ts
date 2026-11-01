/** @vitest-size medium */
import { follow } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { SEND_BLOCK_JOB_NAME } from '@/lib/jobs/names'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { Actor } from '@/lib/types/domain/actor'

import { importRow } from './importRow'
import {
  createImportTestDatabase,
  createPublicNote,
  createRemoteActor,
  resolveStoredAccount
} from './importTestUtils'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))
vi.mock('@/lib/activities', () => ({ follow: vi.fn(), unfollow: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/actors/resolveAccountTarget', () => ({
  resolveAccountTarget: vi.fn()
}))
vi.mock('@/lib/jobs/fetchRemoteStatusJob', () => ({
  fetchRemoteStatusJob: vi.fn()
}))

describe('importRow', () => {
  let database: Database
  let actor: Actor
  let bob: Actor

  beforeEach(async () => {
    ;({ database, actor } = await createImportTestDatabase())
    bob = await createRemoteActor(database, 'bob')
    mockPublish.mockReset().mockResolvedValue(undefined)
    vi.mocked(follow).mockReset().mockResolvedValue(true)
    vi.mocked(fetchRemoteStatusJob).mockReset()
    vi.mocked(resolveAccountTarget)
      .mockReset()
      .mockImplementation(resolveStoredAccount)
    // The remote actors here have no test server: before the outbound trap
    // they failed to fetch over the real network and the import carried on.
    // Reject fetches at the boundary so the same failure happens without a
    // connection.
    fetchMock.resetMocks()
    fetchMock.doMock()
    fetchMock.mockReject(new Error('network down'))
  })

  afterEach(async () => {
    fetchMock.resetMocks()
    fetchMock.dontMock()
    await database.destroy()
  })

  const run = (type: Parameters<typeof importRow>[0]['type'], data = {}) =>
    importRow({ database, actor, type, data })

  describe('accounts', () => {
    it('fails a row whose account cannot be resolved', async () => {
      expect(await run('following', { acct: 'nobody@remote.test' })).toEqual({
        imported: false,
        error: 'Account not found'
      })
    })

    it('fails a row whose domain is not allowed', async () => {
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'forbidden'
      })
      expect(await run('blocking', { acct: 'bob@remote.test' })).toEqual({
        imported: false,
        error: 'Domain not allowed'
      })
    })

    it('follows with the row options and is idempotent', async () => {
      const data = {
        acct: 'bob@remote.test',
        show_reblogs: false,
        notify: true,
        languages: ['en']
      }
      expect(await run('following', data)).toEqual({ imported: true })
      expect(await run('following', data)).toEqual({ imported: true })

      const follows = await database.getFollowing({
        actorId: actor.id,
        limit: 10
      })
      const requested = await database.getAcceptedOrRequestedFollow({
        actorId: actor.id,
        targetActorId: bob.id
      })
      expect(follows).toHaveLength(0)
      expect(requested).toMatchObject({
        reblogs: false,
        notify: true,
        languages: ['en']
      })
      expect(follow).toHaveBeenCalledTimes(1)
    })

    it('uses Mastodon defaults when the row has no options', async () => {
      await run('following', { acct: 'bob@remote.test' })
      expect(
        await database.getAcceptedOrRequestedFollow({
          actorId: actor.id,
          targetActorId: bob.id
        })
      ).toMatchObject({ reblogs: true, notify: false, languages: null })
    })

    it('updates the options of an existing follow without a new Follow', async () => {
      await run('following', { acct: 'bob@remote.test' })
      await run('following', { acct: 'bob@remote.test', notify: true })
      expect(
        (
          await database.getAcceptedOrRequestedFollow({
            actorId: actor.id,
            targetActorId: bob.id
          })
        )?.notify
      ).toBe(true)
      expect(follow).toHaveBeenCalledTimes(1)
    })

    it('keeps the stored preferences of an existing follow when the row has none', async () => {
      await run('following', {
        acct: 'bob@remote.test',
        show_reblogs: false,
        notify: true,
        languages: ['en']
      })
      for (const data of [
        { acct: 'bob@remote.test' },
        {
          acct: 'bob@remote.test',
          show_reblogs: null,
          notify: null,
          languages: null
        }
      ]) {
        await run('following', data)
        expect(
          await database.getAcceptedOrRequestedFollow({
            actorId: actor.id,
            targetActorId: bob.id
          })
        ).toMatchObject({ reblogs: false, notify: true, languages: ['en'] })
      }
    })

    it('does not import following, blocking or muting yourself', async () => {
      for (const type of ['following', 'blocking', 'muting'] as const) {
        const result = await run(type, { acct: 'test1@llun.test' })
        expect(result.imported).toBe(false)
      }
    })

    it('blocks once and federates the Block', async () => {
      expect(await run('blocking', { acct: 'bob@remote.test' })).toEqual({
        imported: true
      })
      expect(await run('blocking', { acct: 'Bob@Remote.test' })).toEqual({
        imported: true
      })
      expect(
        await database.isBlocking({ actorId: actor.id, targetActorId: bob.id })
      ).toBe(true)
      expect(
        mockPublish.mock.calls.filter(
          ([message]) => message.name === SEND_BLOCK_JOB_NAME
        )
      ).toHaveLength(1)
    })

    it('mutes, mapping hide_notifications to the notifications flag', async () => {
      await run('muting', {
        acct: 'bob@remote.test',
        hide_notifications: false
      })
      expect(
        (await database.getMute({ actorId: actor.id, targetActorId: bob.id }))
          ?.notifications
      ).toBe(false)

      await run('muting', { acct: 'bob@remote.test', hide_notifications: true })
      expect(
        (await database.getMute({ actorId: actor.id, targetActorId: bob.id }))
          ?.notifications
      ).toBe(true)
    })
  })

  describe('domain_blocking', () => {
    it('blocks the normalized domain and rejects invalid ones', async () => {
      expect(await run('domain_blocking', { domain: 'Bad.Test' })).toEqual({
        imported: true
      })
      expect(
        await database.isDomainBlockedByActor({
          actorId: actor.id,
          domain: 'bad.test'
        })
      ).toBe(true)
      expect(
        (await run('domain_blocking', { domain: '*.bad.test' })).imported
      ).toBe(false)
      expect((await run('domain_blocking', { domain: '' })).imported).toBe(
        false
      )
    })
  })

  describe('bookmarks', () => {
    it('bookmarks a stored status once', async () => {
      const id = `${bob.id}/statuses/1`
      await createPublicNote(database, id, bob.id)
      expect(await run('bookmarks', { uri: id })).toEqual({ imported: true })
      expect(await run('bookmarks', { uri: id })).toEqual({ imported: true })
      expect(
        await database.getBookmarks({ actorId: actor.id, limit: 10 })
      ).toHaveLength(1)
      expect(fetchRemoteStatusJob).not.toHaveBeenCalled()
    })

    it('fails for an unknown status on this server', async () => {
      const result = await run('bookmarks', {
        uri: `https://${TEST_DOMAIN}/users/test/statuses/nope`
      })
      expect(result).toEqual({ imported: false, error: 'Status not found' })
      expect(fetchRemoteStatusJob).not.toHaveBeenCalled()
    })

    it('fetches an unknown remote status before bookmarking it', async () => {
      const id = `${bob.id}/statuses/remote`
      vi.mocked(fetchRemoteStatusJob).mockImplementation(async () => {
        await createPublicNote(database, id, bob.id)
      })
      expect(await run('bookmarks', { uri: id })).toEqual({ imported: true })
      expect(fetchRemoteStatusJob).toHaveBeenCalledTimes(1)
    })

    it('fails when the remote status cannot be fetched', async () => {
      const result = await run('bookmarks', { uri: `${bob.id}/statuses/gone` })
      expect(result).toEqual({ imported: false, error: 'Status not found' })
    })

    it('does not bookmark a status the actor may not see', async () => {
      const id = `${bob.id}/statuses/private`
      await createPublicNote(database, id, bob.id, 'direct')
      expect((await run('bookmarks', { uri: id })).imported).toBe(false)
      expect(
        await database.getBookmarks({ actorId: actor.id, limit: 10 })
      ).toHaveLength(0)
    })

    it('fails an unparseable uri', async () => {
      expect((await run('bookmarks', { uri: 'not a uri' })).imported).toBe(
        false
      )
    })
  })

  describe('lists', () => {
    it('fails when the list does not exist', async () => {
      expect(
        await run('lists', { list_name: 'Friends', acct: 'bob@remote.test' })
      ).toEqual({ imported: false, error: 'List not found' })
    })

    it('follows the account and adds it to the list, idempotently', async () => {
      const list = await database.createList({
        actorId: actor.id,
        title: 'Friends'
      })
      const data = { list_name: 'Friends', acct: 'bob@remote.test' }
      expect(await run('lists', data)).toEqual({ imported: true })
      expect(await run('lists', data)).toEqual({ imported: true })

      const members = await database.getListMembers({
        listId: list.id,
        actorId: actor.id
      })
      expect(members.map((member) => member.targetActorId)).toEqual([bob.id])
      expect(follow).toHaveBeenCalledTimes(1)
    })

    it('fails a row with an empty or over-long list name', async () => {
      await database.createList({ actorId: actor.id, title: 'Friends' })
      for (const list_name of ['', 'x'.repeat(256)]) {
        expect(
          await run('lists', { list_name, acct: 'bob@remote.test' })
        ).toEqual({ imported: false, error: 'Invalid list name' })
      }
      expect(resolveAccountTarget).not.toHaveBeenCalled()
    })

    it('accepts a list name of exactly 255 characters', async () => {
      const title = 'x'.repeat(255)
      await database.createList({ actorId: actor.id, title })
      expect(
        await run('lists', { list_name: title, acct: 'bob@remote.test' })
      ).toEqual({ imported: true })
    })

    it('adds the owner without following themselves', async () => {
      const list = await database.createList({
        actorId: actor.id,
        title: 'Me'
      })
      expect(
        await run('lists', { list_name: 'Me', acct: 'test1@llun.test' })
      ).toEqual({ imported: true })
      expect(follow).not.toHaveBeenCalled()
      expect(
        await database.getListMembers({ listId: list.id, actorId: actor.id })
      ).toHaveLength(1)
    })
  })

  describe('blocked accounts', () => {
    const setups: [string, () => Promise<unknown>][] = [
      [
        'the importer blocks the account',
        () =>
          database.createBlock({
            actorId: actor.id,
            targetActorId: bob.id,
            uri: `${actor.id}#blocks/bob`
          })
      ],
      [
        'the account blocks the importer',
        () =>
          database.createBlock({
            actorId: bob.id,
            targetActorId: actor.id,
            uri: `${bob.id}#blocks/test1`
          })
      ],
      [
        'the importer blocks the domain',
        () =>
          database.createActorDomainBlock({
            actorId: actor.id,
            domain: bob.domain
          })
      ]
    ]

    describe.each(setups)('when %s', (_name, setup) => {
      beforeEach(async () => {
        await setup()
      })

      it('does not follow from a following row', async () => {
        expect(await run('following', { acct: 'bob@remote.test' })).toEqual({
          imported: false,
          error: 'Account is blocked'
        })
        expect(follow).not.toHaveBeenCalled()
        expect(
          await database.getAcceptedOrRequestedFollow({
            actorId: actor.id,
            targetActorId: bob.id
          })
        ).toBeNull()
      })

      it('neither follows nor adds from a lists row', async () => {
        const list = await database.createList({
          actorId: actor.id,
          title: 'Friends'
        })
        expect(
          await run('lists', { list_name: 'Friends', acct: 'bob@remote.test' })
        ).toEqual({ imported: false, error: 'Account is blocked' })
        expect(follow).not.toHaveBeenCalled()
        expect(
          await database.getListMembers({ listId: list.id, actorId: actor.id })
        ).toHaveLength(0)
      })
    })
  })

  describe('split-domain and moved accounts', () => {
    let alice: Actor

    beforeEach(async () => {
      alice = await createRemoteActor(database, 'alice', 'social.example.com')
      vi.mocked(resolveAccountTarget).mockImplementation(async (params) =>
        params.input === 'alice@example.com'
          ? { type: 'resolved', actor: alice }
          : resolveStoredAccount(params)
      )
    })

    it('refuses to follow when the domain of the handle is blocked, not only the actor host', async () => {
      await database.createActorDomainBlock({
        actorId: actor.id,
        domain: 'example.com'
      })
      expect(await run('following', { acct: 'alice@example.com' })).toEqual({
        imported: false,
        error: 'Account is blocked'
      })
      expect(follow).not.toHaveBeenCalled()
    })

    it('refuses a list row when the domain of the handle is blocked', async () => {
      await database.createActorDomainBlock({
        actorId: actor.id,
        domain: 'example.com'
      })
      await database.createList({ actorId: actor.id, title: 'Friends' })
      expect(
        await run('lists', { list_name: 'Friends', acct: 'alice@example.com' })
      ).toEqual({ imported: false, error: 'Account is blocked' })
      expect(follow).not.toHaveBeenCalled()
    })

    it('refuses to follow or list an account that has moved', async () => {
      const mover = (await database.createActor({
        actorId: 'https://remote.test/users/mover',
        username: 'mover',
        domain: 'remote.test',
        inboxUrl: 'https://remote.test/users/mover/inbox',
        sharedInboxUrl: 'https://remote.test/inbox',
        followersUrl: 'https://remote.test/users/mover/followers',
        publicKey: 'publicKey',
        createdAt: Date.now(),
        movedTo: 'https://remote.test/users/new-home'
      })) as Actor
      expect(mover.movedTo).toBeTruthy()
      await database.createList({ actorId: actor.id, title: 'Friends' })

      expect(await run('following', { acct: 'mover@remote.test' })).toEqual({
        imported: false,
        error: 'Account has moved'
      })
      expect(
        await run('lists', { list_name: 'Friends', acct: 'mover@remote.test' })
      ).toEqual({ imported: false, error: 'Account has moved' })
      expect(follow).not.toHaveBeenCalled()
    })
  })
})

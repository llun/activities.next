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
  })

  afterEach(async () => {
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
})

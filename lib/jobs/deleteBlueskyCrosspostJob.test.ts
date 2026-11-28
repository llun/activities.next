import type { Database } from '@/lib/database/types'
import {
  JobData,
  deleteBlueskyCrosspostJob
} from '@/lib/jobs/deleteBlueskyCrosspostJob'
import { DELETE_BLUESKY_CROSSPOST_JOB_NAME } from '@/lib/jobs/names'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { isBlueskyAllowed } from '@/lib/services/bluesky/policy'
import { logger } from '@/lib/utils/logger'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

vi.mock('@/lib/services/bluesky/policy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isBlueskyAllowed: vi.fn()
}))

const OWN_DID = `did:plc:${'a'.repeat(24)}`
const OTHER_DID = `did:plc:${'b'.repeat(24)}`
const ACTOR_ID = 'https://social.test/users/me'

describe('deleteBlueskyCrosspostJob', () => {
  const get = vi.fn()
  const post = vi.fn()
  const database = {
    getBlueskyAccount: vi.fn(),
    getActorFromId: vi.fn(),
    getBlueskyCrosspostByUri: vi.fn()
  }

  const run = (uri: string, extra?: Record<string, unknown>) =>
    deleteBlueskyCrosspostJob(database as unknown as Database, {
      id: 'job',
      name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
      data: { actorId: ACTOR_ID, uri, ...extra }
    })

  beforeEach(() => {
    get.mockReset()
    post.mockReset().mockResolvedValue({})
    database.getBlueskyAccount.mockReset().mockResolvedValue({ did: OWN_DID })
    database.getActorFromId.mockReset().mockResolvedValue({ id: ACTOR_ID })
    database.getBlueskyCrosspostByUri.mockReset().mockResolvedValue(null)
    vi.mocked(isBlueskyAllowed).mockReset().mockResolvedValue(true)
    vi.mocked(getBlueskyAgent)
      .mockReset()
      .mockResolvedValue({ did: OWN_DID, get, post } as unknown as BlueskyAgent)
  })

  it("deletes the linked account's own record without getRecord when expectedCreatedAt is omitted", async () => {
    await run(`at://${OWN_DID}/app.bsky.feed.post/3kpost`)

    expect(database.getBlueskyCrosspostByUri).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.feed.post',
      rkey: '3kpost'
    })
  })

  it('verifies via getRecord before deleting when expectedCreatedAt is present', async () => {
    const uri = `at://${OWN_DID}/app.bsky.feed.post/3kdet`
    const expectedCreatedAt = '2024-10-27T03:33:20.000Z'

    get.mockResolvedValueOnce({
      uri,
      cid: 'bafycid',
      value: {
        $type: 'app.bsky.feed.post',
        text: 'Hello',
        createdAt: expectedCreatedAt
      }
    })

    await run(uri, { expectedCreatedAt })

    expect(database.getBlueskyCrosspostByUri).toHaveBeenCalledWith({ uri })
    expect(get).toHaveBeenCalledWith('com.atproto.repo.getRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.feed.post',
      rkey: '3kdet'
    })
    expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.feed.post',
      rkey: '3kdet'
    })
  })

  it('skips deleting a deterministic uri when getRecord finds a foreign record or RecordNotFound', async () => {
    const uri = `at://${OWN_DID}/app.bsky.feed.post/3kforeign`
    const expectedCreatedAt = '2024-10-27T03:33:20.000Z'

    // Different createdAt -> foreign record, do not delete.
    get.mockResolvedValueOnce({
      uri,
      cid: 'bafycid',
      value: {
        $type: 'app.bsky.feed.post',
        text: 'Foreign post',
        createdAt: '2024-10-27T03:34:00.000Z'
      }
    })
    await run(uri, { expectedCreatedAt })

    // Wrong $type -> do not delete.
    get.mockResolvedValueOnce({
      uri,
      cid: 'bafycid',
      value: {
        $type: 'app.bsky.feed.like',
        createdAt: expectedCreatedAt
      }
    })
    await run(uri, { expectedCreatedAt })

    // Missing value -> do not delete.
    get.mockResolvedValueOnce({ uri, cid: 'bafycid' })
    await run(uri, { expectedCreatedAt })

    // RecordNotFound -> done without deleting.
    get.mockRejectedValueOnce(
      new BlueskyRequestError(
        'com.atproto.repo.getRecord',
        400,
        'RecordNotFound'
      )
    )
    await expect(run(uri, { expectedCreatedAt })).resolves.toBeUndefined()

    // 404 -> done without deleting.
    get.mockRejectedValueOnce(
      new BlueskyRequestError('com.atproto.repo.getRecord', 404)
    )
    await expect(run(uri, { expectedCreatedAt })).resolves.toBeUndefined()

    expect(post).not.toHaveBeenCalled()

    // Transient getRecord failure -> rethrows so queue retries.
    get.mockRejectedValueOnce(
      new BlueskyRequestError('com.atproto.repo.getRecord', 503)
    )
    await expect(run(uri, { expectedCreatedAt })).rejects.toBeInstanceOf(
      BlueskyRequestError
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('skips deleting a deterministic uri when another cross-post row owns that uri', async () => {
    const uri = `at://${OWN_DID}/app.bsky.feed.post/3kowned`
    const expectedCreatedAt = '2024-10-27T03:33:20.000Z'
    database.getBlueskyCrosspostByUri.mockResolvedValueOnce({
      statusId: 'https://social.test/users/me/statuses/other',
      actorId: ACTOR_ID,
      uri,
      cid: 'bafycid',
      state: 'posted',
      error: null,
      createdAt: 0,
      updatedAt: 0
    })

    await run(uri, { expectedCreatedAt })

    expect(database.getBlueskyCrosspostByUri).toHaveBeenCalledWith({ uri })
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('tolerates a record already deleted on Bluesky and rethrows other failures', async () => {
    post.mockRejectedValueOnce(
      new BlueskyRequestError(
        'com.atproto.repo.deleteRecord',
        400,
        'RecordNotFound'
      )
    )
    await expect(
      run(`at://${OWN_DID}/app.bsky.feed.post/3kgone`)
    ).resolves.toBeUndefined()

    post.mockRejectedValueOnce(
      new BlueskyRequestError('com.atproto.repo.deleteRecord', 503)
    )
    await expect(
      run(`at://${OWN_DID}/app.bsky.feed.post/3kbusy`)
    ).rejects.toBeInstanceOf(BlueskyRequestError)
  })

  it("touches nothing for another account's record, an unlinked actor or a refused server", async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    try {
      // The actor relinked since: the copy belongs to the DID in its uri, and
      // deleting it through the account linked now would touch another repo.
      await run(`at://${OTHER_DID}/app.bsky.feed.post/3kother`)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Skipped deleting a Bluesky cross-post of another account',
          did: OTHER_DID
        })
      )
      await run(`at://${OWN_DID}/app.bsky.feed.like/3klike`)

      database.getBlueskyAccount.mockResolvedValueOnce(null)
      await run(`at://${OWN_DID}/app.bsky.feed.post/3kunlinked`)

      vi.mocked(isBlueskyAllowed).mockResolvedValueOnce(false)
      await run(`at://${OWN_DID}/app.bsky.feed.post/3krefused`)

      expect(post).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('refuses a missing or malformed uri or expectedCreatedAt in its data and touches nothing', async () => {
    expect(JobData.safeParse({ actorId: ACTOR_ID }).success).toBe(false)
    expect(JobData.safeParse({ actorId: ACTOR_ID, uri: '' }).success).toBe(
      false
    )
    expect(
      JobData.safeParse({ actorId: ACTOR_ID, uri: 'not-a-record-uri' }).success
    ).toBe(false)
    expect(
      JobData.safeParse({
        actorId: ACTOR_ID,
        uri: `at://${OWN_DID}/app.bsky.feed.like/3klike`
      }).success
    ).toBe(false)
    expect(
      JobData.safeParse({
        actorId: ACTOR_ID,
        uri: `at://${OWN_DID}/app.bsky.feed.post/3kpost`,
        expectedCreatedAt: 'not-an-iso-date'
      }).success
    ).toBe(false)
    expect(
      JobData.safeParse({
        actorId: ACTOR_ID,
        uri: `at://${OWN_DID}/app.bsky.feed.post/3kpost`,
        expectedCreatedAt: ''
      }).success
    ).toBe(false)
    expect(
      JobData.safeParse({
        actorId: ACTOR_ID,
        uri: `at://${OWN_DID}/app.bsky.feed.post/3kpost`,
        expectedCreatedAt: '2024-10-27T03:33:20.000Z'
      }).success
    ).toBe(true)

    await deleteBlueskyCrosspostJob(database as unknown as Database, {
      id: 'job',
      name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
      data: { actorId: ACTOR_ID }
    })
    await deleteBlueskyCrosspostJob(database as unknown as Database, {
      id: 'job',
      name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
      data: { actorId: ACTOR_ID, uri: 'not-a-record-uri' }
    })
    await deleteBlueskyCrosspostJob(database as unknown as Database, {
      id: 'job',
      name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
      data: {
        actorId: ACTOR_ID,
        uri: `at://${OWN_DID}/app.bsky.feed.post/3kpost`,
        expectedCreatedAt: 'not-an-iso-date'
      }
    })

    expect(database.getBlueskyAccount).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})

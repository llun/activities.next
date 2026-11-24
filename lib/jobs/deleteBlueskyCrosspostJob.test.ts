import type { Database } from '@/lib/database/types'
import { deleteBlueskyCrosspostJob } from '@/lib/jobs/deleteBlueskyCrosspostJob'
import { DELETE_BLUESKY_CROSSPOST_JOB_NAME } from '@/lib/jobs/names'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { isBlueskyAllowed } from '@/lib/services/bluesky/policy'

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
  const post = vi.fn()
  const database = {
    getBlueskyAccount: vi.fn(),
    getActorFromId: vi.fn()
  }

  const run = (uri: string) =>
    deleteBlueskyCrosspostJob(database as unknown as Database, {
      id: 'job',
      name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
      data: { actorId: ACTOR_ID, uri }
    })

  beforeEach(() => {
    post.mockReset().mockResolvedValue({})
    database.getBlueskyAccount.mockReset().mockResolvedValue({ did: OWN_DID })
    database.getActorFromId.mockReset().mockResolvedValue({ id: ACTOR_ID })
    vi.mocked(isBlueskyAllowed).mockReset().mockResolvedValue(true)
    vi.mocked(getBlueskyAgent)
      .mockReset()
      .mockResolvedValue({ did: OWN_DID, post } as unknown as BlueskyAgent)
  })

  it("deletes the linked account's own record", async () => {
    await run(`at://${OWN_DID}/app.bsky.feed.post/3kpost`)

    expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.feed.post',
      rkey: '3kpost'
    })
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
    await run(`at://${OTHER_DID}/app.bsky.feed.post/3kother`)
    await run(`at://${OWN_DID}/app.bsky.feed.like/3klike`)

    database.getBlueskyAccount.mockResolvedValueOnce(null)
    await run(`at://${OWN_DID}/app.bsky.feed.post/3kunlinked`)

    vi.mocked(isBlueskyAllowed).mockResolvedValueOnce(false)
    await run(`at://${OWN_DID}/app.bsky.feed.post/3krefused`)

    expect(post).not.toHaveBeenCalled()
  })
})

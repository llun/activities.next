import type { Database } from '@/lib/database/types'
import { crosspostBlueskyJob } from '@/lib/jobs/crosspostBlueskyJob'
import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import { crosspostStatus } from '@/lib/services/bluesky/crosspost'

vi.mock('@/lib/services/bluesky/crosspost', () => ({
  crosspostStatus: vi.fn()
}))

describe('crosspostBlueskyJob', () => {
  const database = {} as Database

  beforeEach(() => {
    vi.mocked(crosspostStatus).mockReset().mockResolvedValue(undefined)
  })

  it('cross-posts the status of the message', async () => {
    await crosspostBlueskyJob(database, {
      id: 'job-1',
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: { statusId: 'https://social.test/users/a/statuses/1' }
    })

    expect(crosspostStatus).toHaveBeenCalledWith(
      database,
      'https://social.test/users/a/statuses/1'
    )
  })

  it('ignores a message without a status id', async () => {
    await crosspostBlueskyJob(database, {
      id: 'job-2',
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: {}
    })

    expect(crosspostStatus).not.toHaveBeenCalled()
  })

  it('rethrows a passing failure so the queue retries', async () => {
    vi.mocked(crosspostStatus).mockRejectedValue(new Error('busy'))

    await expect(
      crosspostBlueskyJob(database, {
        id: 'job-3',
        name: CROSSPOST_BLUESKY_JOB_NAME,
        data: { statusId: 's' }
      })
    ).rejects.toThrow('busy')
  })
})

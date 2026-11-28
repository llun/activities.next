import type { Database } from '@/lib/database/types'
import { SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME } from '@/lib/jobs/names'
import { syncHostedBlueskyProfileJob } from '@/lib/jobs/syncHostedBlueskyProfileJob'
import { syncHostedBlueskyProfile } from '@/lib/services/pds/profile'

vi.mock('@/lib/services/pds/profile', () => ({
  syncHostedBlueskyProfile: vi.fn()
}))

describe('syncHostedBlueskyProfileJob', () => {
  const database = {} as Database

  beforeEach(() => {
    vi.mocked(syncHostedBlueskyProfile).mockReset().mockResolvedValue(undefined)
  })

  it('syncs the profile of the message actor', async () => {
    await syncHostedBlueskyProfileJob(database, {
      id: 'job-1',
      name: SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME,
      data: { actorId: 'actor-1' }
    })

    expect(syncHostedBlueskyProfile).toHaveBeenCalledWith(database, 'actor-1')
  })

  it('ignores a message without an actor id', async () => {
    await syncHostedBlueskyProfileJob(database, {
      id: 'job-2',
      name: SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME,
      data: {}
    })

    expect(syncHostedBlueskyProfile).not.toHaveBeenCalled()
  })
})

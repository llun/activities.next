import type { Database } from '@/lib/database/types'
import { SYNC_BLUESKY_HOME_JOB_NAME } from '@/lib/jobs/names'
import { syncBlueskyHomeJob } from '@/lib/jobs/syncBlueskyHomeJob'
import { syncBlueskyHome } from '@/lib/services/bluesky/sync'

vi.mock('@/lib/services/bluesky/sync', () => ({ syncBlueskyHome: vi.fn() }))

const actor = { id: 'https://social.example/users/a' }

const run = (database: unknown, data: unknown = { actorId: actor.id }) =>
  syncBlueskyHomeJob(database as Database, {
    id: 'job',
    name: SYNC_BLUESKY_HOME_JOB_NAME,
    data: data as Record<string, unknown>
  })

describe('syncBlueskyHomeJob', () => {
  beforeEach(() => {
    vi.mocked(syncBlueskyHome).mockReset()
  })

  it('syncs the Home of an actor with a linked account', async () => {
    const database = {
      getActorFromId: vi.fn().mockResolvedValue(actor),
      getBlueskyAccount: vi.fn().mockResolvedValue({ actorId: actor.id })
    }
    await run(database)
    expect(database.getActorFromId).toHaveBeenCalledWith({ id: actor.id })
    expect(syncBlueskyHome).toHaveBeenCalledWith(database, actor)
  })

  it('skips an actor that unlinked since the job was published', async () => {
    await run({
      getActorFromId: vi.fn().mockResolvedValue(actor),
      getBlueskyAccount: vi.fn().mockResolvedValue(null)
    })
    expect(syncBlueskyHome).not.toHaveBeenCalled()
  })

  it('skips an actor that is gone, and malformed data', async () => {
    const database = {
      getActorFromId: vi.fn().mockResolvedValue(null),
      getBlueskyAccount: vi.fn()
    }
    await run(database)
    await run(database, { nope: true })
    expect(syncBlueskyHome).not.toHaveBeenCalled()
  })
})

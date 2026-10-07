import { SEND_UPDATE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'

const publish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

describe('publishActorUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    publish.mockReset()
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  it('queues an actor update job stamped with the change time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    publish.mockResolvedValue(undefined)

    await publishActorUpdate({ actorId: 'https://llun.test/users/test1' })

    expect(publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: SEND_UPDATE_ACTOR_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/test1',
        updatedAt: 1700000000000
      }
    })
  })

  it('logs instead of throwing when the queue refuses the job', async () => {
    const error = vi.spyOn(logger, 'error')
    publish.mockRejectedValue(new Error('queue unavailable'))

    await expect(
      publishActorUpdate({ actorId: 'https://llun.test/users/test1' })
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'https://llun.test/users/test1',
        err: expect.anything()
      })
    )
  })
})

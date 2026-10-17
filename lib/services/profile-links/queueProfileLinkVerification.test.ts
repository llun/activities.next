import { VERIFY_PROFILE_LINKS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

import { queueProfileLinkVerification } from './queueProfileLinkVerification'

const publish = vi.fn()
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

const ACTOR_ID = 'https://llun.test/users/anna'

describe('queueProfileLinkVerification', () => {
  beforeEach(() => {
    publish.mockReset()
    publish.mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  it('queues the check when a value changed', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ value: 'https://a.example' }],
      after: [{ value: 'https://b.example' }]
    })

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: VERIFY_PROFILE_LINKS_JOB_NAME,
        data: { actorId: ACTOR_ID }
      })
    )
  })

  it('queues the check for a newly created actor with fields', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: undefined,
      after: [{ value: 'https://a.example' }]
    })

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('queues nothing when the values are unchanged', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ value: 'https://a.example' }],
      after: [{ value: 'https://a.example' }]
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('queues nothing when there are no fields', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ value: 'https://a.example' }],
      after: []
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('does not throw when the queue refuses the job', async () => {
    publish.mockRejectedValue(new Error('queue down'))

    await expect(
      queueProfileLinkVerification({
        actorId: ACTOR_ID,
        before: undefined,
        after: [{ value: 'https://a.example' }]
      })
    ).resolves.toBeUndefined()
  })
})

import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { getQueue } from '@/lib/services/queue'
import { NoQueue } from '@/lib/services/queue/noqueue'
import { publishInbound } from '@/lib/services/queue/publishInbound'
import { Queue } from '@/lib/services/queue/type'

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

const message = { id: 'job-1', name: 'test-job', data: {} }

describe('publishInbound', () => {
  it('enqueues on a real broker', async () => {
    const queue = {
      runsInline: false,
      dropsDelayedJobs: false,
      publish: vi.fn().mockResolvedValue(undefined),
      handle: vi.fn()
    } satisfies Queue
    vi.mocked(getQueue).mockReturnValue(
      queue as unknown as ReturnType<typeof getQueue>
    )

    await publishInbound(message)

    expect(queue.publish).toHaveBeenCalledWith(message)
    expect(queue.handle).not.toHaveBeenCalled()
  })

  // NoQueue's publish logs this error for a user request; an inbox needs it so
  // the sender's delivery is retried.
  it('surfaces an undecidable policy from an inline NoQueue job', async () => {
    const queue = new NoQueue()
    vi.spyOn(queue, 'handle').mockRejectedValue(
      new FederationPolicyUnavailableError()
    )
    vi.mocked(getQueue).mockReturnValue(queue)

    await expect(publishInbound(message)).rejects.toBeInstanceOf(
      FederationPolicyUnavailableError
    )
    await expect(queue.publish(message)).resolves.toBeUndefined()
  })
})

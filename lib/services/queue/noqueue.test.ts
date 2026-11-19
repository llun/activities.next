import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { logger } from '@/lib/utils/logger'

import { NoQueue } from './noqueue'
import { JobMessage } from './type'

describe('NoQueue', () => {
  let queue: NoQueue

  beforeEach(() => {
    queue = new NoQueue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('publish', () => {
    it('calls handle with the message', async () => {
      const message: JobMessage = {
        id: 'job-123',
        name: 'testJob',
        data: { key: 'value' }
      }

      const handle = vi.spyOn(queue, 'handle').mockResolvedValue(undefined)

      await expect(queue.publish(message)).resolves.toBeUndefined()
      expect(handle).toHaveBeenCalledTimes(1)
      expect(handle).toHaveBeenCalledWith(message)
    })

    it('drops delayed messages instead of running them immediately', async () => {
      const message: JobMessage = {
        id: 'job-delayed',
        name: 'testJob',
        data: { key: 'value' },
        delaySeconds: 600
      }
      const handle = vi.spyOn(queue, 'handle')

      await expect(queue.publish(message)).resolves.toBeUndefined()
      expect(handle).not.toHaveBeenCalled()
    })

    it('logs a warning and resolves on FederationPolicyUnavailableError while rejecting other errors', async () => {
      const warn = vi.spyOn(logger, 'warn')
      const message: JobMessage = {
        id: 'job-policy-unavailable',
        name: 'testJob',
        data: { key: 'value' }
      }
      const handle = vi
        .spyOn(queue, 'handle')
        .mockRejectedValueOnce(new FederationPolicyUnavailableError())
        .mockRejectedValueOnce(new Error('job failed'))

      await expect(queue.publish(message)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(
        { name: message.name },
        'NoQueue: skipped a job whose federation policy could not be read'
      )

      await expect(queue.publish(message)).rejects.toThrow('job failed')
      expect(handle).toHaveBeenCalledTimes(2)
    })
  })
})

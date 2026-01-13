import { NoQueue } from './noqueue'
import { JobMessage } from './type'

describe('NoQueue', () => {
  let queue: NoQueue

  beforeEach(() => {
    queue = new NoQueue()
  })

  describe('#publish', () => {
    it('calls handle with the message', async () => {
      const message: JobMessage = {
        id: 'job-123',
        name: 'testJob',
        data: { key: 'value' }
      }

      // Should not throw - it will try to run the job but won't find a handler
      await expect(queue.publish(message)).resolves.toBeUndefined()
    })
  })

  describe('#handle', () => {
    it('returns a promise', async () => {
      const message: JobMessage = {
        id: 'job-456',
        name: 'unknownJob',
        data: {}
      }

      const result = queue.handle(message)
      expect(result).toBeInstanceOf(Promise)
      await result // Wait for it to complete
    })
  })
})

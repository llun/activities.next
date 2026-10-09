import { NoQueue } from './noqueue'
import { JobMessage } from './type'

describe('NoQueue', () => {
  let queue: NoQueue

  beforeEach(() => {
    queue = new NoQueue()
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
  })
})

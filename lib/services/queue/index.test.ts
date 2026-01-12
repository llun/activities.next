import { getQueue } from './index'
import { NoQueue } from './noqueue'

describe('queue index', () => {
  describe('#getQueue', () => {
    it('returns NoQueue by default', () => {
      const queue = getQueue()

      expect(queue).toBeInstanceOf(NoQueue)
    })

    it('returns the same instance on subsequent calls (memoized)', () => {
      const queue1 = getQueue()
      const queue2 = getQueue()

      expect(queue1).toBe(queue2)
    })
  })
})

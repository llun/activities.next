import { getQueueConfig } from './queue'

describe('Queue config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('getQueueConfig', () => {
    it('returns null when no queue env vars', () => {
      const config = getQueueConfig()
      expect(config).toBeNull()
    })

    it('returns null for unknown queue type', () => {
      process.env.ACTIVITIES_QUEUE_TYPE = 'unknown'

      const config = getQueueConfig()
      expect(config).toBeNull()
    })

    it('returns qstash config when queue type is qstash', () => {
      process.env.ACTIVITIES_QUEUE_TYPE = 'qstash'
      process.env.ACTIVITIES_QUEUE_URL = 'https://qstash.upstash.io'
      process.env.ACTIVITIES_QUEUE_TOKEN = 'test-token'
      process.env.ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY = 'current-key'
      process.env.ACTIVITIES_QUEUE_NEXT_SIGNING_KEY = 'next-key'

      const config = getQueueConfig()

      expect(config).not.toBeNull()
      expect(config?.queue.type).toBe('qstash')
      expect(config?.queue.url).toBe('https://qstash.upstash.io')
      expect(config?.queue.token).toBe('test-token')
    })
  })
})

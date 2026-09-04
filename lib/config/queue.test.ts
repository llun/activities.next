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
      if (config?.queue.type === 'qstash') {
        expect(config.queue.url).toBe('https://qstash.upstash.io')
        expect(config.queue.token).toBe('test-token')
      }
    })

    it('returns cloudtasks config when queue type is cloudtasks', () => {
      process.env.ACTIVITIES_QUEUE_TYPE = 'cloudtasks'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_SERVICE_ACCOUNT =
        'sa@example.iam.gserviceaccount.com'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE = 'https://example.com'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_SECRET = 'secret123'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_MAX_RETRIES = '3'

      const config = getQueueConfig()

      expect(config).not.toBeNull()
      expect(config?.queue.type).toBe('cloudtasks')
      if (config?.queue.type === 'cloudtasks') {
        expect(config.queue.serviceAccount).toBe(
          'sa@example.iam.gserviceaccount.com'
        )
        expect(config.queue.audience).toBe('https://example.com')
        expect(config.queue.secret).toBe('secret123')
        expect(config.queue.maxRetries).toBe(3)
      }
    })
  })
})

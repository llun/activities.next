import fs from 'fs'
import path from 'path'

import {
  DatabaseQueueConfig,
  QStashConfig,
  QueueConfig,
  getQueueConfig
} from './queue'

const databaseMock = vi.fn()
vi.mock('@/lib/database', () => {
  databaseMock()
  return {
    getDatabase: vi.fn(),
    getKnex: vi.fn()
  }
})

const jobsMock = vi.fn()
vi.mock('@/lib/jobs', () => {
  jobsMock()
  return {
    JOBS: {}
  }
})

const googleCloudTasksMock = vi.fn()
vi.mock('@google-cloud/tasks', () => {
  googleCloudTasksMock()
  return {}
})

const qstashMock = vi.fn()
vi.mock('@upstash/qstash', () => {
  qstashMock()
  return {}
})

describe('Queue config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('DatabaseQueueConfig schema', () => {
    it('accepts valid database queue config', () => {
      const parsed = DatabaseQueueConfig.safeParse({
        type: 'database',
        maxRetries: 5,
        pollIntervalMs: 2000
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual({
          type: 'database',
          maxRetries: 5,
          pollIntervalMs: 2000
        })
      }
    })

    it('accepts database queue config with minimal options', () => {
      const parsed = DatabaseQueueConfig.safeParse({ type: 'database' })
      expect(parsed.success).toBe(true)
    })

    it('rejects non-positive maxRetries', () => {
      expect(
        DatabaseQueueConfig.safeParse({ type: 'database', maxRetries: 0 })
          .success
      ).toBe(false)
      expect(
        DatabaseQueueConfig.safeParse({ type: 'database', maxRetries: -1 })
          .success
      ).toBe(false)
    })

    it('rejects non-positive pollIntervalMs', () => {
      expect(
        DatabaseQueueConfig.safeParse({ type: 'database', pollIntervalMs: 0 })
          .success
      ).toBe(false)
      expect(
        DatabaseQueueConfig.safeParse({
          type: 'database',
          pollIntervalMs: -100
        }).success
      ).toBe(false)
    })

    it('rejects incorrect type discriminator', () => {
      expect(DatabaseQueueConfig.safeParse({ type: 'qstash' }).success).toBe(
        false
      )
    })
  })

  describe('QStashConfig schema', () => {
    it('accepts valid qstash queue config', () => {
      const parsed = QStashConfig.safeParse({
        type: 'qstash',
        url: 'https://qstash.example.com',
        token: 'test-token',
        currentSigningKey: 'current-key',
        nextSigningKey: 'next-key',
        maxRetries: 3
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual({
          type: 'qstash',
          url: 'https://qstash.example.com',
          token: 'test-token',
          currentSigningKey: 'current-key',
          nextSigningKey: 'next-key',
          maxRetries: 3
        })
      }
    })

    it('accepts zero maxRetries because nonnegative is allowed', () => {
      const parsed = QStashConfig.safeParse({
        type: 'qstash',
        url: 'https://qstash.example.com',
        token: 'test-token',
        currentSigningKey: 'current-key',
        nextSigningKey: 'next-key',
        maxRetries: 0
      })
      expect(parsed.success).toBe(true)
    })

    it('rejects invalid URL', () => {
      const parsed = QStashConfig.safeParse({
        type: 'qstash',
        url: 'not-a-valid-url',
        token: 'test-token',
        currentSigningKey: 'current-key',
        nextSigningKey: 'next-key'
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects negative maxRetries', () => {
      const parsed = QStashConfig.safeParse({
        type: 'qstash',
        url: 'https://qstash.example.com',
        token: 'test-token',
        currentSigningKey: 'current-key',
        nextSigningKey: 'next-key',
        maxRetries: -1
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects missing required signing keys', () => {
      const parsed = QStashConfig.safeParse({
        type: 'qstash',
        url: 'https://qstash.example.com',
        token: 'test-token'
      })
      expect(parsed.success).toBe(false)
    })
  })

  describe('QueueConfig union schema', () => {
    it('validates each variant within the discriminated union', () => {
      const databaseParsed = QueueConfig.safeParse({
        type: 'database',
        maxRetries: 2
      })
      expect(databaseParsed.success).toBe(true)

      const qstashParsed = QueueConfig.safeParse({
        type: 'qstash',
        url: 'https://qstash.example.com',
        token: 'token',
        currentSigningKey: 'k1',
        nextSigningKey: 'k2'
      })
      expect(qstashParsed.success).toBe(true)

      const cloudtasksParsed = QueueConfig.safeParse({
        type: 'cloudtasks',
        url: 'https://example.com/api/v1/queue/cloudtasks',
        queue: 'tasks'
      })
      expect(cloudtasksParsed.success).toBe(true)

      const unknownParsed = QueueConfig.safeParse({
        type: 'unknown'
      })
      expect(unknownParsed.success).toBe(false)
    })
  })

  describe('isolated import regression', () => {
    it('does not load database, job registry, or optional queue SDKs on import', () => {
      expect(databaseMock).not.toHaveBeenCalled()
      expect(jobsMock).not.toHaveBeenCalled()
      expect(googleCloudTasksMock).not.toHaveBeenCalled()
      expect(qstashMock).not.toHaveBeenCalled()
    })

    it('does not load database, job registry, or optional queue SDKs on fresh dynamic import', async () => {
      databaseMock.mockClear()
      jobsMock.mockClear()
      googleCloudTasksMock.mockClear()
      qstashMock.mockClear()

      vi.resetModules()
      const imported = await import('./queue')

      expect(imported.DatabaseQueueConfig).toBeDefined()
      expect(imported.QStashConfig).toBeDefined()
      expect(imported.CloudTasksConfig).toBeDefined()
      expect(imported.QueueConfig).toBeDefined()
      expect(imported.getQueueConfig).toBeDefined()

      expect(databaseMock).not.toHaveBeenCalled()
      expect(jobsMock).not.toHaveBeenCalled()
      expect(googleCloudTasksMock).not.toHaveBeenCalled()
      expect(qstashMock).not.toHaveBeenCalled()
    })

    it('has no static dependency on database, jobs, queue services, or optional queue SDKs', () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'lib/config/queue.ts'),
        'utf-8'
      )
      expect(source).not.toContain('@/lib/database')
      expect(source).not.toContain('@/lib/jobs')
      expect(source).not.toContain('@/lib/services/queue')
      expect(source).not.toContain('@google-cloud/tasks')
      expect(source).not.toContain('@upstash/qstash')
    })
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

    it('returns database config when queue type is database', () => {
      process.env.ACTIVITIES_QUEUE_TYPE = 'database'
      process.env.ACTIVITIES_QUEUE_DATABASE_MAX_RETRIES = '8'
      process.env.ACTIVITIES_QUEUE_DATABASE_POLL_INTERVAL_MS = '2500'

      const config = getQueueConfig()

      expect(config).not.toBeNull()
      expect(config?.queue.type).toBe('database')
      if (config?.queue.type === 'database') {
        expect(config.queue.maxRetries).toBe(8)
        expect(config.queue.pollIntervalMs).toBe(2500)
      }
    })

    it('uses defaults for database queue when specific env vars are omitted', () => {
      process.env.ACTIVITIES_QUEUE_TYPE = 'database'

      const config = getQueueConfig()

      expect(config).not.toBeNull()
      expect(config?.queue.type).toBe('database')
      if (config?.queue.type === 'database') {
        expect(config.queue.maxRetries).toBe(16)
        expect(config.queue.pollIntervalMs).toBe(1000)
      }
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
      process.env.ACTIVITIES_QUEUE_URL =
        'https://example.com/api/v1/queue/cloudtasks'
      process.env.ACTIVITIES_QUEUE_NAME = 'my-tasks-queue'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_LOCATION = 'us-central1'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_PROJECT_ID = 'my-custom-project'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_SERVICE_ACCOUNT =
        'sa@example.iam.gserviceaccount.com'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE = 'https://example.com'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_SECRET = 'secret123'
      process.env.ACTIVITIES_QUEUE_CLOUDTASKS_MAX_RETRIES = '3'

      const config = getQueueConfig()

      expect(config).not.toBeNull()
      expect(config?.queue.type).toBe('cloudtasks')
      if (config?.queue.type === 'cloudtasks') {
        expect(config.queue.url).toBe(
          'https://example.com/api/v1/queue/cloudtasks'
        )
        expect(config.queue.queue).toBe('my-tasks-queue')
        expect(config.queue.location).toBe('us-central1')
        expect(config.queue.project).toBe('my-custom-project')
        expect(config.queue.serviceAccount).toBe(
          'sa@example.iam.gserviceaccount.com'
        )
        expect(config.queue.audience).toBe('https://example.com')
        expect(config.queue.secret).toBe('secret123')
        expect(config.queue.maxRetries).toBe(3)
      }
    })

    it('uses defaults and FIREBASE_PROJECT_ID fallback for cloudtasks', () => {
      process.env.ACTIVITIES_QUEUE_TYPE = 'cloudtasks'
      process.env.FIREBASE_PROJECT_ID = 'firebase-project-fallback'

      const config = getQueueConfig()

      expect(config).not.toBeNull()
      expect(config?.queue.type).toBe('cloudtasks')
      if (config?.queue.type === 'cloudtasks') {
        expect(config.queue.location).toBe('europe-west1')
        expect(config.queue.project).toBe('firebase-project-fallback')
        expect(config.queue.maxRetries).toBe(5)
      }
    })
  })
})

import { propagation } from '@opentelemetry/api'

import { CloudTasksConfig } from '@/lib/config/queue'

import { CloudTasksQueue } from './cloudtasks'
import { JobMessage } from './type'

const mockCreateTask = vi.fn()
const mockQueuePath = vi.fn(
  (project: string, location: string, queue: string) =>
    `projects/${project}/locations/${location}/queues/${queue}`
)
const mockGetProjectId = vi.fn().mockResolvedValue('resolved-project-id')

vi.mock('@google-cloud/tasks', () => {
  class MockCloudTasksClient {
    createTask = mockCreateTask
    queuePath = mockQueuePath
    getProjectId = mockGetProjectId
  }
  return {
    CloudTasksClient: MockCloudTasksClient,
    protos: {}
  }
})

describe('CloudTasksQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateTask.mockResolvedValue([{}])
    mockGetProjectId.mockResolvedValue('resolved-project-id')
  })

  it('declares runsInline as false', () => {
    const queue = new CloudTasksQueue()
    expect(queue.runsInline).toBe(false)
  })

  describe('publish', () => {
    const baseConfig: CloudTasksConfig = {
      type: 'cloudtasks',
      url: 'https://queue.example.com/api/v1/queue/cloudtasks',
      queue: 'test-queue',
      location: 'us-central1',
      project: 'test-project'
    }

    const testMessage: JobMessage = {
      id: 'job-123',
      name: 'createNote',
      data: { noteId: 'note-456' }
    }

    it('enqueues a task with correct queue path, HTTP method, URL, headers, and base64 body', async () => {
      const queue = new CloudTasksQueue(baseConfig)

      await queue.publish(testMessage)

      expect(mockQueuePath).toHaveBeenCalledWith(
        'test-project',
        'us-central1',
        'test-queue'
      )
      expect(mockCreateTask).toHaveBeenCalledTimes(1)
      expect(mockCreateTask).toHaveBeenCalledWith({
        parent: 'projects/test-project/locations/us-central1/queues/test-queue',
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: 'https://queue.example.com/api/v1/queue/cloudtasks',
            headers: {
              'Content-Type': 'application/json'
            },
            body: Buffer.from(JSON.stringify(testMessage)).toString('base64')
          }
        }
      })
    })

    it('resolves project from client.getProjectId() and defaults location to europe-west1 when omitted', async () => {
      const queue = new CloudTasksQueue({
        type: 'cloudtasks',
        url: 'https://queue.example.com/api/v1/queue/cloudtasks',
        queue: 'test-queue'
      })

      await queue.publish(testMessage)

      expect(mockGetProjectId).toHaveBeenCalledTimes(1)
      expect(mockQueuePath).toHaveBeenCalledWith(
        'resolved-project-id',
        'europe-west1',
        'test-queue'
      )
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          parent:
            'projects/resolved-project-id/locations/europe-west1/queues/test-queue'
        })
      )
    })

    it('configures OIDC token when serviceAccount and audience are provided', async () => {
      const queue = new CloudTasksQueue({
        ...baseConfig,
        serviceAccount: 'test-sa@example.iam.gserviceaccount.com',
        audience: 'https://queue.example.com'
      })

      await queue.publish(testMessage)

      expect(mockCreateTask).toHaveBeenCalledWith({
        parent: 'projects/test-project/locations/us-central1/queues/test-queue',
        task: {
          httpRequest: expect.objectContaining({
            oidcToken: {
              serviceAccountEmail: 'test-sa@example.iam.gserviceaccount.com',
              audience: 'https://queue.example.com'
            }
          })
        }
      })
    })

    it('configures OIDC token without audience if audience is not provided', async () => {
      const queue = new CloudTasksQueue({
        ...baseConfig,
        serviceAccount: 'test-sa@example.iam.gserviceaccount.com'
      })

      await queue.publish(testMessage)

      expect(mockCreateTask).toHaveBeenCalledWith({
        parent: 'projects/test-project/locations/us-central1/queues/test-queue',
        task: {
          httpRequest: expect.objectContaining({
            oidcToken: {
              serviceAccountEmail: 'test-sa@example.iam.gserviceaccount.com'
            }
          })
        }
      })
    })

    it('sets secret header and Bearer authorization when secret is configured without serviceAccount', async () => {
      const queue = new CloudTasksQueue({
        ...baseConfig,
        secret: 'webhook-secret-token'
      })

      await queue.publish(testMessage)

      expect(mockCreateTask).toHaveBeenCalledWith({
        parent: 'projects/test-project/locations/us-central1/queues/test-queue',
        task: {
          httpRequest: expect.objectContaining({
            headers: expect.objectContaining({
              'x-cloudtasks-secret': 'webhook-secret-token',
              Authorization: 'Bearer webhook-secret-token'
            })
          })
        }
      })
    })

    it('sets secret header without overriding Authorization when both secret and serviceAccount are configured', async () => {
      const queue = new CloudTasksQueue({
        ...baseConfig,
        serviceAccount: 'test-sa@example.iam.gserviceaccount.com',
        secret: 'webhook-secret-token'
      })

      await queue.publish(testMessage)

      const callArgs = mockCreateTask.mock.calls[0][0]
      const headers = callArgs.task.httpRequest.headers
      expect(headers['x-cloudtasks-secret']).toBe('webhook-secret-token')
      expect(headers['Authorization']).toBeUndefined()
      expect(callArgs.task.httpRequest.oidcToken).toEqual({
        serviceAccountEmail: 'test-sa@example.iam.gserviceaccount.com'
      })
    })

    it('schedules task with scheduleTime when delaySeconds is positive', async () => {
      const now = 1700000000000
      vi.spyOn(Date, 'now').mockReturnValue(now)

      const queue = new CloudTasksQueue(baseConfig)
      const delayedMessage: JobMessage = {
        ...testMessage,
        delaySeconds: 120
      }

      await queue.publish(delayedMessage)

      expect(mockCreateTask).toHaveBeenCalledWith({
        parent: 'projects/test-project/locations/us-central1/queues/test-queue',
        task: expect.objectContaining({
          scheduleTime: {
            seconds: 1700000000 + 120
          }
        })
      })

      vi.restoreAllMocks()
    })

    it('does not set scheduleTime when delaySeconds is zero or not specified', async () => {
      const queue = new CloudTasksQueue(baseConfig)

      await queue.publish({ ...testMessage, delaySeconds: 0 })

      const callArgs = mockCreateTask.mock.calls[0][0]
      expect(callArgs.task.scheduleTime).toBeUndefined()
    })

    it('propagates OpenTelemetry trace headers into HTTP request headers', async () => {
      const injectSpy = vi
        .spyOn(propagation, 'inject')
        .mockImplementation((_ctx, carrier) => {
          ;(carrier as Record<string, string>)['traceparent'] =
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
        })

      const queue = new CloudTasksQueue(baseConfig)
      await queue.publish(testMessage)

      expect(injectSpy).toHaveBeenCalled()
      expect(mockCreateTask).toHaveBeenCalledWith({
        parent: 'projects/test-project/locations/us-central1/queues/test-queue',
        task: {
          httpRequest: expect.objectContaining({
            headers: expect.objectContaining({
              traceparent:
                '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
            })
          })
        }
      })

      injectSpy.mockRestore()
    })

    it('throws when URL is not configured', async () => {
      const queue = new CloudTasksQueue({
        type: 'cloudtasks',
        queue: 'test-queue'
      })

      await expect(queue.publish(testMessage)).rejects.toThrow(
        'Cloud Tasks queue URL is not configured'
      )
      expect(mockCreateTask).not.toHaveBeenCalled()
    })

    it('throws when queue name is not configured', async () => {
      const queue = new CloudTasksQueue({
        type: 'cloudtasks',
        url: 'https://queue.example.com/api/v1/queue/cloudtasks'
      })

      await expect(queue.publish(testMessage)).rejects.toThrow(
        'Cloud Tasks queue name is not configured'
      )
      expect(mockCreateTask).not.toHaveBeenCalled()
    })

    it('propagates error when createTask rejects', async () => {
      mockCreateTask.mockRejectedValueOnce(
        new Error('Google Cloud Tasks API error')
      )

      const queue = new CloudTasksQueue(baseConfig)

      await expect(queue.publish(testMessage)).rejects.toThrow(
        'Google Cloud Tasks API error'
      )
    })
  })

  describe('handle', () => {
    it('returns a promise when handling a job message', async () => {
      const queue = new CloudTasksQueue()
      const message: JobMessage = {
        id: 'job-789',
        name: 'unknownJob',
        data: {}
      }

      const result = queue.handle(message)
      expect(result).toBeInstanceOf(Promise)
      await result
    })
  })
})

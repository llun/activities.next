import { jwtVerify } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getQueue } from '@/lib/services/queue'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { POST } from './route'

vi.mock('@/lib/config')
vi.mock('@/lib/database')
vi.mock('@/lib/services/queue')
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn()
}))

describe('POST /api/v1/queue/cloudtasks', () => {
  let harness: ReturnType<typeof setupRecordingTracer>
  const mockHandle = vi.fn()
  const mockCreateDeadLetterJob = vi.fn()

  beforeEach(() => {
    harness = setupRecordingTracer()
    vi.clearAllMocks()

    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'cloudtasks',
        serviceAccount: 'worker@example.iam.gserviceaccount.com',
        audience: 'https://example.com/api/v1/queue/cloudtasks',
        secret: 'test-secret',
        maxRetries: 5
      }
    } as ReturnType<typeof getConfig>)

    vi.mocked(getQueue).mockReturnValue({
      publish: vi.fn(),
      handle: mockHandle,
      runsInline: false
    } as unknown as ReturnType<typeof getQueue>)

    vi.mocked(getDatabase).mockReturnValue({
      createDeadLetterJob: mockCreateDeadLetterJob
    } as unknown as ReturnType<typeof getDatabase>)
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('returns 404 if queue type is not cloudtasks', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'qstash'
      }
    } as ReturnType<typeof getConfig>)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(404)
  })

  it('returns 401 when unauthenticated and auth is configured', async () => {
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer invalid-token'
        }
      }
    )

    vi.mocked(jwtVerify).mockRejectedValue(new Error('Invalid token'))

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('authenticates successfully via authorized service account header', async () => {
    mockHandle.mockResolvedValue(undefined)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalled()
  })

  it('authenticates successfully via valid secret', async () => {
    mockHandle.mockResolvedValue(undefined)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer test-secret'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalled()
  })

  it('authenticates successfully via Google OIDC JWT', async () => {
    mockHandle.mockResolvedValue(undefined)
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'worker@example.iam.gserviceaccount.com',
        aud: 'https://example.com/api/v1/queue/cloudtasks'
      },
      protectedHeader: { alg: 'RS256' }
    })

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer valid-jwt-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalled()
  })

  it('returns 200 on successful job processing', async () => {
    mockHandle.mockResolvedValue(undefined)

    const body = { id: 'msg-success', name: 'sampleJob', data: { key: 'val' } }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com',
          'x-cloudtasks-taskretrycount': '0'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalledWith(body)
    expect(mockCreateDeadLetterJob).not.toHaveBeenCalled()
  })

  it('returns 500 on intermediate retry failure', async () => {
    const error = new Error('Database connection lost')
    mockHandle.mockRejectedValue(error)

    const body = { id: 'msg-retry', name: 'failingJob', data: {} }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com',
          'x-cloudtasks-taskretrycount': '2',
          'x-cloudtasks-taskexecutioncount': '2'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(500)
    expect(mockCreateDeadLetterJob).not.toHaveBeenCalled()
  })

  it('returns 200 ACK and creates record in dead_letter_jobs on terminal retry failure', async () => {
    const error = new Error('Permanent parsing error')
    mockHandle.mockRejectedValue(error)
    mockCreateDeadLetterJob.mockResolvedValue({})

    const body = {
      id: 'msg-terminal',
      name: 'terminalJob',
      data: { count: 42 }
    }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com',
          'x-cloudtasks-taskretrycount': '4',
          'x-cloudtasks-taskexecutioncount': '4'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)

    expect(mockCreateDeadLetterJob).toHaveBeenCalledWith({
      jobName: 'terminalJob',
      payload: body,
      errorMessage: 'Permanent parsing error',
      errorStack: expect.any(String),
      attempts: 5,
      status: 'failed'
    })
  })

  it('returns 400 on invalid JSON or missing job name', async () => {
    const invalidJsonRequest = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: 'invalid-json',
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com'
        }
      }
    )
    const res1 = await POST(invalidJsonRequest, { params: Promise.resolve({}) })
    expect(res1.status).toBe(400)

    const missingNameRequest = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-no-name' }),
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com'
        }
      }
    )
    const res2 = await POST(missingNameRequest, { params: Promise.resolve({}) })
    expect(res2.status).toBe(400)
  })
})

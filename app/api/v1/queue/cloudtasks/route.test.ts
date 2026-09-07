import { jwtVerify } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getQueue } from '@/lib/services/queue'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { POST } from './route'

const mockJWKS = vi.fn()
vi.mock('@/lib/config')
vi.mock('@/lib/database')
vi.mock('@/lib/services/queue')
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => mockJWKS),
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

  it('returns 404 if queue config is missing', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: undefined
    } as unknown as ReturnType<typeof getConfig>)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(404)
    expect(mockHandle).not.toHaveBeenCalled()
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
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when cloudtasks auth config is completely missing', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'cloudtasks'
      }
    } as ReturnType<typeof getConfig>)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer some-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when only audience is configured without service account', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'cloudtasks',
        audience: 'https://example.com/api/v1/queue/cloudtasks'
      }
    } as ReturnType<typeof getConfig>)

    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'arbitrary@example.com',
        email_verified: true,
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
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when service account is configured but neither audience nor url is configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'cloudtasks',
        serviceAccount: 'worker@example.iam.gserviceaccount.com'
      }
    } as ReturnType<typeof getConfig>)

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
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when request is missing credentials', async () => {
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 and rejects spoofed x-service-account header without valid credentials', async () => {
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
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 and rejects spoofed x-cloudtasks-serviceaccount header without valid credentials', async () => {
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          'x-cloudtasks-serviceaccount':
            'worker@example.iam.gserviceaccount.com'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
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

  it('returns 401 when OIDC token has wrong issuer', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(
      new Error('unexpected "iss" claim value')
    )

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer wrong-issuer-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when OIDC token has wrong audience', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(
      new Error('unexpected "aud" claim value')
    )

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer wrong-aud-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when OIDC token email does not match configured service account', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'attacker@example.iam.gserviceaccount.com',
        email_verified: true,
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
          authorization: 'Bearer wrong-email-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when OIDC token email is not verified', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'worker@example.iam.gserviceaccount.com',
        email_verified: false,
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
          authorization: 'Bearer unverified-email-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when OIDC token email_verified is missing', async () => {
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
          authorization: 'Bearer missing-email-verified-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('authenticates successfully via valid secret in authorization header', async () => {
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

  it('authenticates successfully via valid secret in x-cloudtasks-secret header', async () => {
    mockHandle.mockResolvedValue(undefined)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          'x-cloudtasks-secret': 'test-secret'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalled()
  })

  it('authenticates successfully via valid secret in x-cloudtasks-token header', async () => {
    mockHandle.mockResolvedValue(undefined)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          'x-cloudtasks-token': 'test-secret'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalled()
  })

  it('returns 401 when secret header does not match configured secret', async () => {
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          'x-cloudtasks-secret': 'wrong-secret'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('authenticates successfully via Google OIDC JWT', async () => {
    mockHandle.mockResolvedValue(undefined)
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'worker@example.iam.gserviceaccount.com',
        email_verified: true,
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
    expect(jwtVerify).toHaveBeenCalledWith(
      'valid-jwt-token',
      expect.any(Function),
      {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: 'https://example.com/api/v1/queue/cloudtasks'
      }
    )
  })

  it('authenticates successfully via Google OIDC JWT falling back to url when audience is unset', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'cloudtasks',
        serviceAccount: 'worker@example.iam.gserviceaccount.com',
        url: 'https://fallback.example.com/api/v1/queue/cloudtasks',
        maxRetries: 5
      }
    } as ReturnType<typeof getConfig>)

    mockHandle.mockResolvedValue(undefined)
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'worker@example.iam.gserviceaccount.com',
        email_verified: true,
        aud: 'https://fallback.example.com/api/v1/queue/cloudtasks'
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
    expect(jwtVerify).toHaveBeenCalledWith(
      'valid-jwt-token',
      expect.any(Function),
      {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: 'https://fallback.example.com/api/v1/queue/cloudtasks'
      }
    )
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
          authorization: 'Bearer test-secret',
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
          authorization: 'Bearer test-secret',
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
          authorization: 'Bearer test-secret',
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

  it('returns 500 when database is unavailable on terminal failure', async () => {
    mockHandle.mockRejectedValue(new Error('Permanent failure'))
    vi.mocked(getDatabase).mockReturnValue(null)

    const body = {
      id: 'msg-terminal-nodb',
      name: 'terminalJob',
      data: {}
    }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          authorization: 'Bearer test-secret',
          'x-cloudtasks-taskretrycount': '4',
          'x-cloudtasks-taskexecutioncount': '4'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json).toEqual({ error: 'Database unavailable' })
  })

  it('returns 500 when dead letter job persistence fails on terminal failure', async () => {
    mockHandle.mockRejectedValue(new Error('Permanent failure'))
    mockCreateDeadLetterJob.mockRejectedValue(new Error('DB connection lost'))

    const body = {
      id: 'msg-terminal-persist-fail',
      name: 'terminalJob',
      data: {}
    }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          authorization: 'Bearer test-secret',
          'x-cloudtasks-taskretrycount': '4',
          'x-cloudtasks-taskexecutioncount': '4'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json).toEqual({ error: 'Failed to record dead letter job' })
    expect(mockCreateDeadLetterJob).toHaveBeenCalled()
  })

  it('returns 401 when authorization header has empty bearer token', async () => {
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          authorization: 'Bearer '
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when spoofed x-service-account is accompanied by invalid secret', async () => {
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-1', name: 'testJob', data: {} }),
        headers: {
          'x-service-account': 'worker@example.iam.gserviceaccount.com',
          'x-cloudtasks-secret': 'wrong-secret'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 401 when OIDC token email_verified is not a boolean true', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        email: 'worker@example.iam.gserviceaccount.com',
        email_verified: 'true' as unknown as boolean,
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
          authorization: 'Bearer string-email-verified-token'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON or missing job name', async () => {
    const invalidJsonRequest = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: 'invalid-json',
        headers: {
          authorization: 'Bearer test-secret'
        }
      }
    )
    const res1 = await POST(invalidJsonRequest, { params: Promise.resolve({}) })
    expect(res1.status).toBe(400)
    expect(mockHandle).not.toHaveBeenCalled()

    const missingNameRequest = new NextRequest(
      'https://activities.local/api/v1/queue/cloudtasks',
      {
        method: 'POST',
        body: JSON.stringify({ id: 'msg-no-name' }),
        headers: {
          authorization: 'Bearer test-secret'
        }
      }
    )
    const res2 = await POST(missingNameRequest, { params: Promise.resolve({}) })
    expect(res2.status).toBe(400)
    expect(mockHandle).not.toHaveBeenCalled()
  })
})

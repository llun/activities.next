import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { POST } from './route'

const mockGetDatabase = vi.fn()
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

const mockQueue = { runsInline: false, publish: vi.fn() }
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => mockQueue
}))

const webhook = (overrides: Record<string, unknown> = {}) =>
  new NextRequest('https://example.test/api/v1/webhooks/wahoo/', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'workout_summary',
      webhook_token: 'webhook-token-123',
      user: { id: 55 },
      workout_summary: {
        id: 99,
        updated_at: '2026-09-20T12:30:00.000Z',
        workout: { id: 77 }
      },
      ...overrides
    })
  })

describe('Wahoo webhook', () => {
  const mockDb = {
    getWahooSettingsByWebhookToken: vi.fn(),
    updateFitnessSettings: vi.fn(),
    upsertWahooImport: vi.fn(),
    updateWahooImport: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueue.runsInline = false
    mockGetDatabase.mockReturnValue(mockDb as unknown as Database)
    mockDb.getWahooSettingsByWebhookToken.mockResolvedValue({
      id: 'settings-1',
      actorId: 'actor-1',
      serviceType: 'wahoo',
      accessToken: 'access-token',
      webhookToken: 'webhook-token-123'
    })
    mockDb.updateFitnessSettings.mockResolvedValue(undefined)
    mockDb.upsertWahooImport.mockResolvedValue({
      id: 'import-1',
      status: 'pending',
      created: true
    })
    mockDb.updateWahooImport.mockResolvedValue(undefined)
    mockQueue.publish.mockResolvedValue(undefined)
  })

  it('requires a durable queue before accepting webhooks', async () => {
    mockQueue.runsInline = true

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Durable queue required for Wahoo webhooks'
    })
    expect(mockGetDatabase).not.toHaveBeenCalled()
  })

  it('binds the webhook token to the provider account', async () => {
    mockDb.getWahooSettingsByWebhookToken.mockResolvedValue(null)

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    expect(mockDb.getWahooSettingsByWebhookToken).toHaveBeenCalledWith(
      'webhook-token-123',
      '55'
    )
    expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
    expect(mockDb.upsertWahooImport).not.toHaveBeenCalled()
  })

  it('upserts a workout revision and queues the durable import', async () => {
    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.upsertWahooImport).toHaveBeenCalledWith({
      actorId: 'actor-1',
      providerUserId: '55',
      workoutId: '77',
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ImportWahooActivityJob',
        data: {
          importId: 'import-1',
          notifyOnComplete: true,
          ignoreHistoryCancellation: true
        }
      })
    )
  })

  it('does not queue a duplicate job when a webhook arrives while import is pending', async () => {
    mockDb.upsertWahooImport.mockResolvedValue({
      id: 'import-1',
      status: 'pending',
      created: false,
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:00:00.000Z')
    })

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockQueue.publish).not.toHaveBeenCalled()
    expect(mockDb.updateWahooImport).toHaveBeenCalledWith('import-1', {
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })
  })

  it('does not queue a duplicate job when a webhook arrives while import is running', async () => {
    mockDb.upsertWahooImport.mockResolvedValue({
      id: 'import-1',
      status: 'running',
      created: false,
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:00:00.000Z')
    })

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockQueue.publish).not.toHaveBeenCalled()
    expect(mockDb.updateWahooImport).toHaveBeenCalledWith('import-1', {
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })
  })

  it('does not queue a completed import when a duplicate webhook arrives', async () => {
    mockDb.upsertWahooImport.mockResolvedValue({
      id: 'completed-import',
      status: 'completed',
      created: false,
      hadStatus: true,
      statusId: 'status-1',
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.upsertWahooImport).toHaveBeenCalledOnce()
    expect(mockQueue.publish).not.toHaveBeenCalled()
  })

  it('queues a completed import when a newer summary revision arrives', async () => {
    mockDb.upsertWahooImport.mockResolvedValue({
      id: 'completed-import',
      status: 'completed',
      created: false,
      hadStatus: true,
      statusId: 'status-1',
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:00:00.000Z')
    })

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.updateWahooImport).toHaveBeenCalledWith('completed-import', {
      status: 'pending',
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ImportWahooActivityJob',
        data: {
          importId: 'completed-import',
          notifyOnComplete: true,
          ignoreHistoryCancellation: true
        }
      })
    )
  })

  it('retries a failed import when a webhook arrives and marks it pending', async () => {
    mockDb.upsertWahooImport.mockResolvedValue({
      id: 'failed-import',
      status: 'failed',
      created: false,
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:00:00.000Z')
    })

    const response = await POST(webhook(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.updateWahooImport).toHaveBeenCalledWith('failed-import', {
      status: 'pending',
      summaryId: '99',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ImportWahooActivityJob',
        data: {
          importId: 'failed-import',
          notifyOnComplete: true,
          ignoreHistoryCancellation: true
        }
      })
    )
  })

  it('rejects an oversized body with 413 before parsing or touching the database', async () => {
    const response = await POST(webhook({ padding: 'x'.repeat(200 * 1024) }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(413)
    expect(mockGetDatabase).not.toHaveBeenCalled()
    expect(mockDb.getWahooSettingsByWebhookToken).not.toHaveBeenCalled()
  })
})

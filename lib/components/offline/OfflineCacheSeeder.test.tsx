/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OfflineCacheSeeder } from '@/lib/components/offline/OfflineCacheSeeder'
import type { Status } from '@/lib/types/domain/status'

const mockRequestPersistentOfflineStorage = vi.fn().mockResolvedValue(true)
const mockGetOfflineTimeline = vi.fn()
const mockSaveOfflineTimeline = vi.fn().mockResolvedValue(undefined)
const mockSaveClientBootstrapSnapshot = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/client/offline', () => ({
  requestPersistentOfflineStorage: () => mockRequestPersistentOfflineStorage(),
  getOfflineTimeline: (args: any) => mockGetOfflineTimeline(args),
  saveOfflineTimeline: (args: any) => mockSaveOfflineTimeline(args),
  saveClientBootstrapSnapshot: (args: any) =>
    mockSaveClientBootstrapSnapshot(args)
}))

const mockGetAccountBootstrap = vi.fn()
vi.mock('@/lib/client/bootstrap', () => ({
  getAccountBootstrap: () => mockGetAccountBootstrap()
}))

describe('OfflineCacheSeeder', () => {
  const dummyStatus = {
    id: 'status-1',
    actorId: 'actor-1',
    type: 'Note',
    text: 'Hello offline world',
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as unknown as Status

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests persistent storage, seeds initial timeline when none cached, and saves bootstrap snapshot', async () => {
    mockGetOfflineTimeline.mockResolvedValueOnce(null)
    const mockSnapshot = {
      accountId: 'account-1',
      actorId: 'actor-1',
      host: 'llun.social',
      savedAt: Date.now()
    }
    mockGetAccountBootstrap.mockResolvedValueOnce(mockSnapshot)

    render(
      <OfflineCacheSeeder
        actorId="actor-1"
        accountId="account-1"
        initialStatuses={[dummyStatus]}
        initialTimelineContext={{ ancestorsById: {} }}
        initialNextMaxStatusId="status-0"
      />
    )

    await waitFor(() => {
      expect(mockRequestPersistentOfflineStorage).toHaveBeenCalled()
      expect(mockGetOfflineTimeline).toHaveBeenCalledWith({
        actorId: 'actor-1',
        timeline: 'home',
        filterKey: 'all'
      })
      expect(mockSaveOfflineTimeline).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          timeline: 'home',
          filterKey: 'all',
          segments: [
            {
              statuses: [dummyStatus],
              nextMaxStatusId: 'status-0',
              prevMinStatusId: null
            }
          ]
        })
      )
      expect(mockGetAccountBootstrap).toHaveBeenCalled()
      expect(mockSaveClientBootstrapSnapshot).toHaveBeenCalledWith(mockSnapshot)
    })
  })

  it('does not overwrite timeline when an existing cached timeline is already present', async () => {
    mockGetOfflineTimeline.mockResolvedValueOnce({
      actorId: 'actor-1',
      statuses: [dummyStatus],
      segments: []
    })
    mockGetAccountBootstrap.mockResolvedValueOnce(null)

    render(
      <OfflineCacheSeeder
        actorId="actor-1"
        accountId="account-1"
        initialStatuses={[dummyStatus]}
        initialTimelineContext={{ ancestorsById: {} }}
        initialNextMaxStatusId="status-0"
      />
    )

    await waitFor(() => {
      expect(mockRequestPersistentOfflineStorage).toHaveBeenCalled()
      expect(mockGetOfflineTimeline).toHaveBeenCalled()
      expect(mockSaveOfflineTimeline).not.toHaveBeenCalled()
    })
  })

  it('handles bootstrap fetch error without throwing', async () => {
    mockGetOfflineTimeline.mockResolvedValueOnce(null)
    mockGetAccountBootstrap.mockRejectedValueOnce(new Error('Network error'))

    expect(() =>
      render(
        <OfflineCacheSeeder actorId="actor-1" initialStatuses={[dummyStatus]} />
      )
    ).not.toThrow()

    await waitFor(() => {
      expect(mockSaveOfflineTimeline).toHaveBeenCalled()
      expect(mockSaveClientBootstrapSnapshot).not.toHaveBeenCalled()
    })
  })
})

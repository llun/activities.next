/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/lib/client'

import { StravaArchiveImportSection } from './StravaArchiveImportSection'

vi.mock('@/lib/client', () => ({
  ApiRequestError: class extends Error {},
  cancelStravaArchiveImport: vi.fn(),
  getActiveStravaArchiveImport: vi.fn(),
  getFitnessImportBatch: vi.fn(),
  retryStravaArchiveImport: vi.fn(),
  startStravaArchiveImport: vi.fn()
}))

const mockGetActive = vi.mocked(client.getActiveStravaArchiveImport)
const mockGetBatch = vi.mocked(client.getFitnessImportBatch)

const importing = {
  id: 'import-1',
  archiveId: 'archive-1',
  archiveFitnessFileId: 'file-1',
  batchId: 'batch-1',
  visibility: 'private' as const,
  status: 'importing' as const,
  nextActivityIndex: 0,
  mediaAttachmentRetry: 0,
  totalActivitiesCount: 2,
  completedActivitiesCount: 1,
  failedActivitiesCount: 1,
  firstFailureMessage: null,
  lastError: null,
  pendingMediaActivitiesCount: 0,
  createdAt: 0,
  updatedAt: 0
}

const batch = (status: 'completed' | 'partially_failed') => ({
  batchId: 'batch-1',
  status,
  summary: { total: 2, pending: 0, completed: 1, failed: 1 },
  files: []
})

describe('StravaArchiveImportSection messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetActive
      .mockResolvedValueOnce({ activeImport: importing })
      .mockResolvedValue({ activeImport: null })
  })

  it('says a running import is info, not success', async () => {
    mockGetBatch.mockResolvedValue({
      ...batch('completed'),
      status: 'pending' as never
    })
    render(<StravaArchiveImportSection />)
    const message = await screen.findByText(
      'A Strava archive import is currently running.'
    )
    expect(message.closest('[data-tone]')).toHaveAttribute('data-tone', 'info')
  })

  it('warns when an import finishes with partial failures', async () => {
    mockGetBatch.mockResolvedValue(batch('partially_failed'))
    render(<StravaArchiveImportSection />)
    const message = await screen.findByText(
      'Strava archive import finished with partial failures.'
    )
    expect(message.closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'warning'
    )
  })

  it('reports a completed import as success', async () => {
    mockGetBatch.mockResolvedValue(batch('completed'))
    render(<StravaArchiveImportSection />)
    const message = await screen.findByText('Strava archive import completed.')
    expect(message.closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'success'
    )
  })
})

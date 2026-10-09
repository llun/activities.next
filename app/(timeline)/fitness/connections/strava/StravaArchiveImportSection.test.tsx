/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  type ActiveStravaArchiveImport,
  type FitnessImportBatchResult,
  cancelStravaArchiveImport,
  getActiveStravaArchiveImport,
  getFitnessImportBatch,
  retryStravaArchiveImport,
  startStravaArchiveImport
} from '@/lib/client'
import { ApiRequestError } from '@/lib/client/http'
import { createDeferred } from '@/lib/testing/deferred'

import { StravaArchiveImportSection } from './StravaArchiveImportSection'

vi.mock('@/lib/client', async () => {
  const { ApiRequestError } = await import('@/lib/client/http')
  return {
    ApiRequestError,
    cancelStravaArchiveImport: vi.fn(),
    getActiveStravaArchiveImport: vi.fn(),
    getFitnessImportBatch: vi.fn(),
    retryStravaArchiveImport: vi.fn(),
    startStravaArchiveImport: vi.fn()
  }
})

const mockGetActive = vi.mocked(getActiveStravaArchiveImport)
const mockGetBatch = vi.mocked(getFitnessImportBatch)
const mockStart = vi.mocked(startStravaArchiveImport)
const mockRetry = vi.mocked(retryStravaArchiveImport)
const mockCancel = vi.mocked(cancelStravaArchiveImport)

const activeImport = (
  overrides: Partial<ActiveStravaArchiveImport> = {}
): ActiveStravaArchiveImport => ({
  id: 'import-1',
  archiveId: 'archive-1',
  archiveFitnessFileId: 'file-1',
  batchId: 'batch-1',
  visibility: 'private',
  status: 'importing',
  nextActivityIndex: 0,
  mediaAttachmentRetry: 0,
  totalActivitiesCount: 10,
  completedActivitiesCount: 3,
  failedActivitiesCount: 1,
  firstFailureMessage: null,
  lastError: null,
  pendingMediaActivitiesCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const batchResult = (
  status: FitnessImportBatchResult['status'],
  summary = { total: 10, pending: 0, completed: 10, failed: 0 }
): FitnessImportBatchResult => ({
  batchId: 'batch-1',
  status,
  summary,
  files: []
})

// Settle pending promises and any timers due within `ms`.
const advance = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const renderSection = async (actorHandle?: string) => {
  render(<StravaArchiveImportSection actorHandle={actorHandle} />)
  await advance()
}

const zip = (name = 'export.zip') =>
  new File(['zip'], name, { type: 'application/zip' })

const chooseFile = (file: File | null) => {
  fireEvent.change(screen.getByLabelText('Archive File'), {
    target: { files: file ? [file] : [] }
  })
}

const importButton = () =>
  screen.getByRole('button', {
    name: /^(Import archive|Starting import…|Uploading…)$/
  })

describe('StravaArchiveImportSection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mockGetActive.mockResolvedValue({ activeImport: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('with no import in progress', () => {
    it('names the actor the import applies to', async () => {
      await renderSection('@llun@llun.dev')

      expect(
        screen.getByText(/Archive import always applies to @llun@llun.dev/)
      ).toBeInTheDocument()
    })

    it('falls back to the current actor when no handle is given', async () => {
      await renderSection()

      expect(
        screen.getByText(/applies to your current actor/)
      ).toBeInTheDocument()
    })

    it('keeps import disabled until an archive is chosen', async () => {
      await renderSection()

      expect(importButton()).toBeDisabled()
      expect(screen.getByLabelText('Archive File')).toBeEnabled()
      expect(mockGetBatch).not.toHaveBeenCalled()
    })

    it('accepts a ZIP, shows its name and enables import', async () => {
      await renderSection()

      chooseFile(zip('strava-2026.ZIP'))

      expect(screen.getByText('strava-2026.ZIP')).toBeInTheDocument()
      expect(importButton()).toBeEnabled()
    })

    it('rejects a non-ZIP file with an error and keeps import disabled', async () => {
      await renderSection()

      chooseFile(new File(['x'], 'activities.csv'))

      expect(
        screen.getByText('Please select a valid Strava export ZIP archive.')
      ).toBeInTheDocument()
      expect(screen.queryByText('activities.csv')).not.toBeInTheDocument()
      expect(importButton()).toBeDisabled()
    })

    it('clears the chosen archive when the selection is emptied', async () => {
      await renderSection()
      chooseFile(zip())

      chooseFile(null)

      expect(screen.queryByText('export.zip')).not.toBeInTheDocument()
      expect(importButton()).toBeDisabled()
    })

    it('clears a previous file error once a valid ZIP is chosen', async () => {
      await renderSection()
      chooseFile(new File(['x'], 'activities.csv'))

      chooseFile(zip())

      expect(
        screen.queryByText('Please select a valid Strava export ZIP archive.')
      ).not.toBeInTheDocument()
    })

    it('surfaces a failure to load the import state', async () => {
      mockGetActive.mockRejectedValue(new Error('state unavailable'))

      await renderSection()

      expect(screen.getByText('state unavailable')).toBeInTheDocument()
    })
  })

  describe('starting an import', () => {
    it('uploads the archive as private by default, then polls the new batch', async () => {
      const upload = createDeferred<{
        archiveId: string
        batchId: string
        importId: string
      }>()
      mockStart.mockReturnValue(upload.promise)
      mockGetBatch.mockResolvedValue(
        batchResult('pending', {
          total: 10,
          pending: 9,
          completed: 1,
          failed: 0
        })
      )
      await renderSection()
      const file = zip()
      chooseFile(file)

      fireEvent.click(importButton())
      await advance()

      expect(mockStart).toHaveBeenCalledWith(file, 'private')
      expect(
        screen.getByText('Uploading archive to storage…')
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled()
      expect(screen.getByLabelText('Archive File')).toBeDisabled()

      mockGetActive.mockResolvedValue({ activeImport: activeImport() })
      await act(async () => {
        upload.resolve({
          archiveId: 'archive-1',
          batchId: 'batch-1',
          importId: 'import-1'
        })
      })
      await advance()

      // The server now reports the import as running, which is what the
      // section announces from then on.
      expect(
        screen.getByText('A Strava archive import is currently running.')
      ).toBeInTheDocument()
      expect(screen.getByText('Batch: batch-1')).toBeInTheDocument()
      expect(mockGetBatch).toHaveBeenCalledWith('batch-1')
      expect(screen.getByText(/Completed 1\/10/)).toBeInTheDocument()
      // The chosen file was consumed by the upload.
      expect(screen.queryByText('export.zip')).not.toBeInTheDocument()
    })

    it('confirms the upload when the server has not yet reported a running import', async () => {
      mockStart.mockResolvedValue({
        archiveId: 'archive-1',
        batchId: 'batch-1',
        importId: 'import-1'
      })
      await renderSection()
      chooseFile(zip())

      fireEvent.click(importButton())
      await advance()

      expect(
        screen.getByText(
          'Strava archive uploaded. Import started in the background.'
        )
      ).toBeInTheDocument()
      expect(screen.getByText('Batch: batch-1')).toBeInTheDocument()
      expect(mockGetBatch).not.toHaveBeenCalled()
    })

    it('shows the error and allows another attempt when the upload fails', async () => {
      mockStart.mockRejectedValue(new Error('Archive too large'))
      await renderSection()
      chooseFile(zip())

      fireEvent.click(importButton())
      await advance()

      expect(screen.getByText('Archive too large')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Import archive' })
      ).toBeEnabled()
      expect(mockGetBatch).not.toHaveBeenCalled()
    })

    it('passes the visibility picked in the selector', async () => {
      mockStart.mockRejectedValue(new Error('stop here'))
      await renderSection()
      chooseFile(zip())

      fireEvent.keyDown(
        screen.getByRole('button', {
          name: /Set visibility, current: Followers/
        }),
        { key: 'ArrowDown' }
      )
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Unlisted/ }))
      fireEvent.click(importButton())
      await advance()

      expect(mockStart).toHaveBeenCalledWith(expect.any(File), 'unlisted')
    })
  })

  describe('with an import already running', () => {
    beforeEach(() => {
      mockGetActive.mockResolvedValue({ activeImport: activeImport() })
      mockGetBatch.mockResolvedValue(
        batchResult('pending', {
          total: 10,
          pending: 6,
          completed: 3,
          failed: 1
        })
      )
    })

    it('shows the running import as info and locks the controls', async () => {
      await renderSection()

      expect(
        screen
          .getByText('A Strava archive import is currently running.')
          .closest('[data-tone]')
      ).toHaveAttribute('data-tone', 'info')
      expect(screen.getByText('batch-1')).toBeInTheDocument()
      expect(screen.getByText(/Imported 3\/10/)).toHaveTextContent(
        'Imported 3/10 • Failed 1'
      )
      expect(screen.getByLabelText('Archive File')).toBeDisabled()
      expect(importButton()).toBeDisabled()
    })

    it('omits the total when the archive size is not known yet', async () => {
      mockGetActive.mockResolvedValue({
        activeImport: activeImport({
          totalActivitiesCount: null,
          completedActivitiesCount: 2
        })
      })

      await renderSection()

      expect(screen.getByText(/Imported 2/)).toHaveTextContent(
        'Imported 2 • Failed 1'
      )
    })

    it('polls the batch every two seconds while it is pending', async () => {
      await renderSection()
      expect(mockGetBatch).toHaveBeenCalledTimes(1)
      expect(mockGetBatch).toHaveBeenCalledWith('batch-1')
      expect(screen.getByText(/Completed 3\/10/)).toBeInTheDocument()

      await advance(1_999)
      expect(mockGetBatch).toHaveBeenCalledTimes(1)
      await advance(1)
      expect(mockGetBatch).toHaveBeenCalledTimes(2)
      await advance(2_000)
      expect(mockGetBatch).toHaveBeenCalledTimes(3)
    })

    it('stops polling and announces completion when the batch completes', async () => {
      mockGetBatch.mockResolvedValue(batchResult('completed'))
      mockGetActive
        .mockResolvedValueOnce({ activeImport: activeImport() })
        .mockResolvedValue({ activeImport: null })

      await renderSection()

      expect(
        screen
          .getByText('Strava archive import completed.')
          .closest('[data-tone]')
      ).toHaveAttribute('data-tone', 'success')
      expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute(
        'href',
        '/fitness/files'
      )
      await advance(10_000)
      expect(mockGetBatch).toHaveBeenCalledTimes(1)
    })

    it('reports partial failures when the batch finishes with some failed', async () => {
      mockGetBatch.mockResolvedValue(
        batchResult('partially_failed', {
          total: 10,
          pending: 0,
          completed: 8,
          failed: 2
        })
      )
      mockGetActive
        .mockResolvedValueOnce({ activeImport: activeImport() })
        .mockResolvedValue({ activeImport: null })

      await renderSection()

      expect(
        screen
          .getByText('Strava archive import finished with partial failures.')
          .closest('[data-tone]')
      ).toHaveAttribute('data-tone', 'warning')
      expect(screen.getByText(/Failed 2/)).toBeInTheDocument()
    })

    it('shows the failure instead of "completed" when the import is marked failed afterwards', async () => {
      mockGetBatch.mockResolvedValue(batchResult('failed'))
      mockGetActive
        .mockResolvedValueOnce({ activeImport: activeImport() })
        .mockResolvedValue({
          activeImport: activeImport({
            status: 'failed',
            lastError: 'Disk full'
          })
        })

      await renderSection()

      expect(screen.getByText('Disk full')).toBeInTheDocument()
      expect(
        screen.queryByText('Strava archive import completed.')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/finished with partial failures/)
      ).not.toBeInTheDocument()
    })

    it('keeps waiting while the batch is not yet created (404)', async () => {
      mockGetBatch
        .mockRejectedValueOnce(new ApiRequestError('Not found', 404))
        .mockRejectedValueOnce(new ApiRequestError('Not found', 404))
        .mockResolvedValue(batchResult('pending'))

      await renderSection()
      expect(screen.queryByText('Not found')).not.toBeInTheDocument()
      await advance(2_000)
      await advance(2_000)

      expect(mockGetBatch).toHaveBeenCalledTimes(3)
      expect(screen.queryByText('Not found')).not.toBeInTheDocument()
      expect(screen.getByText(/Completed 10\/10/)).toBeInTheDocument()
    })

    it('gives up with the error after 90 consecutive 404s', async () => {
      mockGetBatch.mockRejectedValue(
        new ApiRequestError('Batch not found', 404)
      )

      await renderSection()
      await advance(2_000 * 95)

      // 90 not-ready responses are tolerated; the 91st one is reported.
      expect(mockGetBatch).toHaveBeenCalledTimes(91)
      expect(screen.getByText('Batch not found')).toBeInTheDocument()
    })

    it('stops polling and shows the error for any other failure', async () => {
      mockGetBatch.mockRejectedValue(new ApiRequestError('Server error', 500))

      await renderSection()
      await advance(10_000)

      expect(mockGetBatch).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })

    it('stops polling when the component unmounts', async () => {
      const { unmount } = render(<StravaArchiveImportSection />)
      await advance()
      expect(mockGetBatch).toHaveBeenCalledTimes(1)

      unmount()
      await advance(10_000)

      expect(mockGetBatch).toHaveBeenCalledTimes(1)
    })
  })

  describe('with a failed import', () => {
    const failed = (overrides: Partial<ActiveStravaArchiveImport> = {}) =>
      activeImport({ status: 'failed', ...overrides })

    it.each([
      [
        'the last error',
        { lastError: 'Disk full', firstFailureMessage: 'Bad GPX' },
        'Disk full'
      ],
      [
        'the first failure when there is no last error',
        { lastError: null, firstFailureMessage: 'Bad GPX' },
        'Bad GPX'
      ],
      [
        'a generic message when nothing was recorded',
        { lastError: null, firstFailureMessage: null },
        'Strava archive import failed. Retry or cancel before importing a new archive.'
      ]
    ])('explains the failure with %s', async (_name, overrides, message) => {
      mockGetActive.mockResolvedValue({ activeImport: failed(overrides) })

      await renderSection()

      expect(screen.getByText(message)).toBeInTheDocument()
      expect(screen.getByLabelText('Archive File')).toBeDisabled()
      expect(importButton()).toBeDisabled()
      // A failed import is not polled until the owner retries.
      expect(mockGetBatch).not.toHaveBeenCalled()
    })

    it('retries and resumes polling the batch', async () => {
      mockGetActive.mockResolvedValue({ activeImport: failed() })
      mockRetry.mockResolvedValue({
        success: true,
        activeImport: activeImport({ batchId: 'batch-2' })
      })
      mockGetBatch.mockResolvedValue(batchResult('pending'))
      await renderSection()

      fireEvent.click(
        screen.getByRole('button', { name: 'Retry and continue' })
      )
      await advance()

      expect(mockRetry).toHaveBeenCalledTimes(1)
      expect(
        screen.getByText('Retrying Strava archive import…')
      ).toBeInTheDocument()
      expect(mockGetBatch).toHaveBeenCalledWith('batch-2')
      expect(screen.getByText('Batch: batch-2')).toBeInTheDocument()
      // The stale failure message is gone and the failed-only actions are hidden.
      expect(
        screen.queryByText(
          'Strava archive import failed. Retry or cancel before importing a new archive.'
        )
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry and continue' })
      ).not.toBeInTheDocument()
    })

    it('shows the error and keeps the actions when the retry request fails', async () => {
      mockGetActive.mockResolvedValue({ activeImport: failed() })
      mockRetry.mockRejectedValue(new Error('Retry refused'))
      await renderSection()

      fireEvent.click(
        screen.getByRole('button', { name: 'Retry and continue' })
      )
      await advance()

      expect(screen.getByText('Retry refused')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Retry and continue' })
      ).toBeEnabled()
      expect(mockGetBatch).not.toHaveBeenCalled()
    })

    it('disables both actions while one is in flight', async () => {
      mockGetActive.mockResolvedValue({ activeImport: failed() })
      const retry = createDeferred<{
        success: boolean
        activeImport: ActiveStravaArchiveImport | null
      }>()
      mockRetry.mockReturnValue(retry.promise)
      mockGetBatch.mockResolvedValue(batchResult('pending'))
      await renderSection()

      fireEvent.click(
        screen.getByRole('button', { name: 'Retry and continue' })
      )
      await advance()
      // While the request is pending both buttons show their busy label.
      expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()

      await act(async () => {
        retry.resolve({ success: true, activeImport: activeImport() })
      })
      await advance()
    })

    it('cancels the import, clears it and reports that imported activities were kept', async () => {
      mockGetActive.mockResolvedValue({ activeImport: failed() })
      mockCancel.mockResolvedValue({ success: true, cancelled: true })
      await renderSection()

      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel and remove archive' })
      )
      await advance()

      expect(mockCancel).toHaveBeenCalledTimes(1)
      expect(
        screen.getByText(
          'Cancelled remaining archive import. Already imported activities were kept.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText('Batch: batch-1')).not.toBeInTheDocument()
      expect(screen.queryByText('Disk full')).not.toBeInTheDocument()
      // The controls unlock so a new archive can be imported.
      expect(screen.getByLabelText('Archive File')).toBeEnabled()
      expect(
        screen.queryByRole('button', { name: 'Cancel and remove archive' })
      ).not.toBeInTheDocument()
    })

    it('shows the error and keeps the failed state when cancelling fails', async () => {
      mockGetActive.mockResolvedValue({ activeImport: failed() })
      mockCancel.mockRejectedValue(new Error('Cancel refused'))
      await renderSection()

      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel and remove archive' })
      )
      await advance()

      expect(screen.getByText('Cancel refused')).toBeInTheDocument()
      expect(screen.getByLabelText('Archive File')).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Cancel and remove archive' })
      ).toBeEnabled()
    })
  })
})

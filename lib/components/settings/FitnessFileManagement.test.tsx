/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { FitnessFileManagement } from './FitnessFileManagement'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn()
  }))
}))

describe('FitnessFileManagement', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('pagination state sync', () => {
    it('updates displayed files when fitnessFiles prop changes', async () => {
      const firstPageFiles = [
        {
          id: 'fitness-1',
          actorId: 'https://example.com/users/alice',
          fileName: 'run.fit',
          fileType: 'fit' as const,
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-1'
        }
      ]

      const secondPageFiles = [
        {
          id: 'fitness-2',
          actorId: 'https://example.com/users/alice',
          fileName: 'ride.gpx',
          fileType: 'gpx' as const,
          mimeType: 'application/gpx+xml',
          bytes: 2048,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-2'
        }
      ]

      const { rerender } = render(
        <FitnessFileManagement
          used={3072}
          limit={10485760}
          fitnessFiles={firstPageFiles}
          currentPage={1}
          itemsPerPage={25}
          totalItems={2}
        />
      )

      expect(screen.getByText('ID: fitness-1')).toBeInTheDocument()
      expect(screen.queryByText('ID: fitness-2')).not.toBeInTheDocument()

      rerender(
        <FitnessFileManagement
          used={3072}
          limit={10485760}
          fitnessFiles={secondPageFiles}
          currentPage={2}
          itemsPerPage={25}
          totalItems={2}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('ID: fitness-2')).toBeInTheDocument()
        expect(screen.queryByText('ID: fitness-1')).not.toBeInTheDocument()
      })
    })
  })

  describe('post link generation', () => {
    it('generates correct link for fitness file associated with a status', () => {
      const files = [
        {
          id: 'fitness-3',
          actorId: 'https://example.com/users/alice',
          fileName: 'hike.tcx',
          fileType: 'tcx' as const,
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 512,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-3',
          statusId: 'https://example.com/users/alice/statuses/123'
        }
      ]

      render(
        <FitnessFileManagement
          used={512}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      const link = screen.getByText('View in post →')
      expect(link).toHaveAttribute(
        'href',
        '/@alice@example.com/https%3A%2F%2Fexample.com%2Fusers%2Falice%2Fstatuses%2F123'
      )
    })
  })

  describe('failed import retry', () => {
    it('surfaces the import error and retries the batch', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          batchId: 'strava-activity:19007245213',
          retried: 1
        })
      } as Response)

      const files = [
        {
          id: 'fitness-failed',
          actorId: 'https://example.com/users/alice',
          fileName: 'strava-19007245213.tcx',
          fileType: 'tcx' as const,
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 1024,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-failed',
          importStatus: 'failed' as const,
          importError: 'relation "collection_members" does not exist',
          importBatchId: 'strava-activity:19007245213'
        }
      ]

      render(
        <FitnessFileManagement
          used={1024}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      expect(screen.getByText('Import failed')).toBeInTheDocument()
      expect(screen.getByText(/collection_members/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Retry import/i }))

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/v1/fitness/import/strava-activity%3A19007245213',
          expect.objectContaining({ method: 'POST' })
        )
      })

      await waitFor(() => {
        expect(screen.getByText(/Retry queued/i)).toBeInTheDocument()
      })
    })

    it('shows an error message when the retry request fails', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        text: async () => 'Retry rejected',
        statusText: 'Bad Request'
      } as Response)

      const files = [
        {
          id: 'fitness-failed',
          actorId: 'https://example.com/users/alice',
          fileName: 'a.tcx',
          fileType: 'tcx' as const,
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 1024,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-failed',
          importStatus: 'failed' as const,
          importError: 'boom',
          importBatchId: 'strava-activity:1'
        }
      ]

      render(
        <FitnessFileManagement
          used={1024}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /Retry import/i }))

      await waitFor(() => {
        expect(screen.getByText('Retry rejected')).toBeInTheDocument()
      })
    })

    it('disables every retry button while a retry is in flight', async () => {
      let resolveFetch: (value: unknown) => void = () => undefined
      vi.spyOn(global, 'fetch').mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve
        }) as unknown as Promise<Response>
      )

      const baseFile = {
        actorId: 'https://example.com/users/alice',
        fileType: 'tcx' as const,
        mimeType: 'application/vnd.garmin.tcx+xml',
        bytes: 1024,
        createdAt: Date.now(),
        importStatus: 'failed' as const,
        importError: 'boom'
      }
      const files = [
        {
          ...baseFile,
          id: 'file-a',
          fileName: 'a.tcx',
          url: '/api/v1/fitness-files/file-a',
          importBatchId: 'strava-activity:A'
        },
        {
          ...baseFile,
          id: 'file-b',
          fileName: 'b.tcx',
          url: '/api/v1/fitness-files/file-b',
          importBatchId: 'strava-activity:B'
        }
      ]

      render(
        <FitnessFileManagement
          used={2048}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={2}
        />
      )

      const retryButtons = screen.getAllByRole('button', {
        name: 'Retry import'
      })
      expect(retryButtons).toHaveLength(2)

      fireEvent.click(retryButtons[0])

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled()
      })
      // The other batch's button is disabled too, so it cannot be dead-clicked.
      expect(
        screen.getByRole('button', { name: 'Retry import' })
      ).toBeDisabled()

      resolveFetch({
        ok: true,
        json: async () => ({ batchId: 'strava-activity:A', retried: 1 })
      })

      await waitFor(() => {
        expect(screen.getByText(/Retry queued/i)).toBeInTheDocument()
      })
    })

    it('does not offer retry for files without an import batch', () => {
      const files = [
        {
          id: 'fitness-orphan',
          actorId: 'https://example.com/users/alice',
          fileName: 'orphan.gpx',
          fileType: 'gpx' as const,
          mimeType: 'application/gpx+xml',
          bytes: 1024,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-orphan',
          importStatus: 'failed' as const,
          importError: 'something went wrong'
        }
      ]

      render(
        <FitnessFileManagement
          used={1024}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      expect(screen.getByText('Import failed')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Retry import/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('delete error handling', () => {
    it('shows an error message when deletion fails', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        text: async () => 'Delete failed',
        statusText: 'Bad Request'
      } as Response)

      const files = [
        {
          id: 'fitness-4',
          actorId: 'https://example.com/users/alice',
          fileName: 'ride.fit',
          fileType: 'fit' as const,
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-4'
        }
      ]

      render(
        <FitnessFileManagement
          used={1024}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByText('Delete Fitness File')).toBeInTheDocument()
      })

      const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/ })
      fireEvent.click(deleteButtons[deleteButtons.length - 1])

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument()
      })
      expect(screen.getByText('ID: fitness-4')).toBeInTheDocument()
    })

    it('parses API JSON errors into readable delete messages', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ status: 'Not Found' }),
        statusText: 'Not Found'
      } as Response)

      const files = [
        {
          id: 'fitness-5',
          actorId: 'https://example.com/users/alice',
          fileName: 'race.gpx',
          fileType: 'gpx' as const,
          mimeType: 'application/gpx+xml',
          bytes: 2048,
          createdAt: Date.now(),
          url: '/api/v1/fitness-files/fitness-5'
        }
      ]

      render(
        <FitnessFileManagement
          used={2048}
          limit={10485760}
          fitnessFiles={files}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await waitFor(() => {
        expect(screen.getByText('Delete Fitness File')).toBeInTheDocument()
      })
      const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/ })
      fireEvent.click(deleteButtons[deleteButtons.length - 1])

      await waitFor(() => {
        expect(screen.getByText('Not Found')).toBeInTheDocument()
      })
    })
  })
})

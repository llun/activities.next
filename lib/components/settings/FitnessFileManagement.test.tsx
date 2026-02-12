/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { FitnessFileManagement } from './FitnessFileManagement'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn()
  }))
}))

describe('FitnessFileManagement', () => {
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
})

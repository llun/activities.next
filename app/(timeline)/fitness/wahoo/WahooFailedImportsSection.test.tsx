/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { WahooFailedImportsSection } from './WahooFailedImportsSection'

vi.mock('@/lib/client', () => ({
  getWahooFailedImports: vi.fn(),
  retryWahooFailedImport: vi.fn()
}))

const failedImport: client.WahooFailedImport = {
  id: 'import-1',
  workoutId: 'workout-1',
  status: 'failed',
  lastError: 'Workout data was incomplete'
}

describe('WahooFailedImportsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.getWahooFailedImports).mockResolvedValue({
      imports: [failedImport]
    })
    vi.mocked(client.retryWahooFailedImport).mockResolvedValue()
  })

  it('shows a failed workout and retries only that import', async () => {
    render(<WahooFailedImportsSection connected automaticImportAvailable />)

    await screen.findByText('Workout workout-1')
    expect(screen.getByText('Workout data was incomplete')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(client.retryWahooFailedImport).toHaveBeenCalledWith('import-1')
    )
  })

  it('explains why retry is disabled without a durable queue', async () => {
    render(
      <WahooFailedImportsSection connected automaticImportAvailable={false} />
    )

    await screen.findByText('Workout workout-1')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(
      screen.getByText(/requires a durable background job queue/i)
    ).toBeInTheDocument()
  })

  it('does not load another account’s imports while disconnected', () => {
    render(
      <WahooFailedImportsSection
        connected={false}
        automaticImportAvailable={false}
      />
    )

    expect(client.getWahooFailedImports).not.toHaveBeenCalled()
    expect(screen.queryByText('Workouts needing attention')).toBeNull()
  })
})

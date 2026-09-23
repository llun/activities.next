/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { WahooHistorySection } from './WahooHistorySection'

vi.mock('@/lib/client', () => ({
  getWahooHistory: vi.fn(),
  startWahooHistory: vi.fn(),
  cancelWahooHistory: vi.fn(),
  retryWahooHistory: vi.fn()
}))

describe('WahooHistorySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.getWahooHistory).mockResolvedValue({ import: null })
  })

  it('explains the queue prerequisite and disables history import without it', async () => {
    render(<WahooHistorySection connected automaticImportAvailable={false} />)

    await waitFor(() => expect(client.getWahooHistory).toHaveBeenCalled())
    expect(
      screen.getByText(/requires a durable background job queue/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Import history' })
    ).toBeDisabled()
    expect(screen.getByLabelText('From')).toBeDisabled()
    expect(screen.getByLabelText('To')).toBeDisabled()
  })

  it('rejects an inverted date range before calling the API', async () => {
    render(<WahooHistorySection connected automaticImportAvailable />)

    await waitFor(() => expect(client.getWahooHistory).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-09-23' }
    })
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-09-01' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import history' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The start date must be on or before the end date.'
    )
    expect(client.startWahooHistory).not.toHaveBeenCalled()
  })

  it('lets the owner resume a cancelled history import', async () => {
    vi.mocked(client.getWahooHistory)
      .mockResolvedValueOnce({
        import: {
          id: 'history-1',
          status: 'cancelled',
          fromDate: '2026-09-01',
          toDate: '2026-09-10',
          total: 5,
          completed: 2,
          failed: 0
        }
      })
      .mockResolvedValueOnce({
        import: {
          id: 'history-1',
          status: 'running',
          fromDate: '2026-09-01',
          toDate: '2026-09-10',
          total: 5,
          completed: 2,
          failed: 0
        }
      })
    vi.mocked(client.retryWahooHistory).mockResolvedValue()

    render(<WahooHistorySection connected automaticImportAvailable />)

    const resumeButton = await screen.findByRole('button', {
      name: 'Resume history import'
    })
    fireEvent.click(resumeButton)

    await waitFor(() => expect(client.retryWahooHistory).toHaveBeenCalled())
    expect(
      await screen.findByText('History import resumed.')
    ).toBeInTheDocument()
    expect(await screen.findByText('running')).toBeInTheDocument()
  })

  it.each([
    {
      status: 'failed' as const,
      connected: false,
      automaticImportAvailable: true,
      buttonName: 'Retry failed workouts'
    },
    {
      status: 'cancelled' as const,
      connected: true,
      automaticImportAvailable: false,
      buttonName: 'Resume history import'
    }
  ])(
    'disables retry actions when the connection or queue is unavailable ($status)',
    async ({ status, connected, automaticImportAvailable, buttonName }) => {
      vi.mocked(client.getWahooHistory).mockResolvedValue({
        import: {
          id: 'history-1',
          status,
          fromDate: '2026-09-01',
          toDate: '2026-09-10',
          total: 5,
          completed: 2,
          failed: 1
        }
      })

      render(
        <WahooHistorySection
          connected={connected}
          automaticImportAvailable={automaticImportAvailable}
        />
      )

      const retryButton = await screen.findByRole('button', {
        name: buttonName
      })
      expect(retryButton).toBeDisabled()
      fireEvent.click(retryButton)
      expect(client.retryWahooHistory).not.toHaveBeenCalled()
    }
  )
})

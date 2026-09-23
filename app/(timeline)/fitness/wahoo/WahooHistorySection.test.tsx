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
})

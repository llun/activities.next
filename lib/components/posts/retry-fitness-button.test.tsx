/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { retryFitnessProcessing } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { RetryFitnessButton } from './retry-fitness-button'

vi.mock('@/lib/client', () => ({
  retryFitnessProcessing: vi.fn()
}))

const statusId = 'https://activities.local/users/llun/statuses/run-1'

describe('RetryFitnessButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['failed', /Processing failed/],
    ['stuck', /taking longer than expected/],
    ['map-missing', /route map image could not be generated/],
    ['map-stale', /previous one/]
  ] as const)('explains the %s variant', (variant, text) => {
    render(<RetryFitnessButton statusId={statusId} variant={variant} />)

    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('defaults to the failed explanation', () => {
    render(<RetryFitnessButton statusId={statusId} />)

    expect(screen.getByText(/Processing failed/)).toBeInTheDocument()
  })

  it('queues a retry for the status and confirms it', async () => {
    ;(retryFitnessProcessing as jest.Mock).mockResolvedValue(undefined)
    render(<RetryFitnessButton statusId={statusId} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(retryFitnessProcessing).toHaveBeenCalledWith(statusId)
    expect(screen.getByText(/Retry queued/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
  })

  it('disables the button while the retry is being queued', async () => {
    const deferred = createDeferred<void>()
    ;(retryFitnessProcessing as jest.Mock).mockReturnValue(deferred.promise)
    render(<RetryFitnessButton statusId={statusId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()

    await act(async () => {
      deferred.resolve()
    })
    expect(screen.getByText(/Retry queued/)).toBeInTheDocument()
  })

  it('shows an error and re-enables the button when queueing fails', async () => {
    ;(retryFitnessProcessing as jest.Mock).mockRejectedValue(
      new Error('network down')
    )
    render(<RetryFitnessButton statusId={statusId} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(screen.getByText('Retry failed. Please try again.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('clears a previous error when retrying again', async () => {
    ;(retryFitnessProcessing as jest.Mock)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined)
    render(<RetryFitnessButton statusId={statusId} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(
      screen.queryByText('Retry failed. Please try again.')
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Retry queued/)).toBeInTheDocument()
  })

  it('does not trigger a parent link or click handler', async () => {
    ;(retryFitnessProcessing as jest.Mock).mockResolvedValue(undefined)
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <RetryFitnessButton statusId={statusId} />
      </div>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(onParentClick).not.toHaveBeenCalled()
  })
})

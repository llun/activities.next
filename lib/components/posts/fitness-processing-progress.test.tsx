/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { getFitnessProcessingState } from '@/lib/client'

import { FitnessProcessingProgress } from './fitness-processing-progress'

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mockRefresh
  })
}))

vi.mock('@/lib/client', () => ({
  getFitnessProcessingState: vi.fn()
}))

const mockGetState = getFitnessProcessingState as jest.MockedFunction<
  typeof getFitnessProcessingState
>

describe('FitnessProcessingProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the queued stage label and a progress bar', () => {
    render(
      <FitnessProcessingProgress
        statusId="status-1"
        initialProcessingStatus="pending"
      />
    )

    expect(screen.getByText('Queued for processing…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('advances the stage label as the file moves from pending to processing', async () => {
    mockGetState.mockResolvedValue({
      processingStatus: 'processing',
      processingStuck: false,
      hasMapData: false
    })

    render(
      <FitnessProcessingProgress
        statusId="status-1"
        initialProcessingStatus="pending"
        pollIntervalMs={1_000}
      />
    )

    await vi.advanceTimersByTimeAsync(1_000)

    await waitFor(() => {
      expect(screen.getByText('Generating route map…')).toBeInTheDocument()
    })
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('refreshes the post once processing completes', async () => {
    mockGetState.mockResolvedValue({
      processingStatus: 'completed',
      processingStuck: false,
      hasMapData: true
    })

    render(
      <FitnessProcessingProgress
        statusId="status-1"
        initialProcessingStatus="processing"
        pollIntervalMs={1_000}
      />
    )

    await vi.advanceTimersByTimeAsync(1_000)

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('refreshes the post when the file becomes stuck', async () => {
    mockGetState.mockResolvedValue({
      processingStatus: 'processing',
      processingStuck: true,
      hasMapData: false
    })

    render(
      <FitnessProcessingProgress
        statusId="status-1"
        initialProcessingStatus="processing"
        pollIntervalMs={1_000}
      />
    )

    await vi.advanceTimersByTimeAsync(1_000)

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('stops polling after reaching a terminal state', async () => {
    mockGetState.mockResolvedValue({
      processingStatus: 'completed',
      processingStuck: false,
      hasMapData: true
    })

    render(
      <FitnessProcessingProgress
        statusId="status-1"
        initialProcessingStatus="processing"
        pollIntervalMs={1_000}
      />
    )

    await vi.advanceTimersByTimeAsync(5_000)

    // A single terminal poll triggers exactly one refresh; no rescheduling.
    expect(mockGetState).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})

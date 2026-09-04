/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  discardDeadLetterJob,
  retryDeadLetterJob
} from '@/app/(timeline)/admin/queues/actions'
import { DeadLetterJob } from '@/lib/types/database/operations'

import { AdminQueuesList } from './AdminQueuesList'

vi.mock('@/app/(timeline)/admin/queues/actions', () => ({
  retryDeadLetterJob: vi.fn().mockResolvedValue({ success: true }),
  discardDeadLetterJob: vi.fn().mockResolvedValue({ success: true })
}))

const sampleJob: DeadLetterJob = {
  id: 'job-123',
  jobName: 'syncProfile',
  payload: { id: 'm-1', name: 'syncProfile', data: { actor: 'alice' } },
  errorMessage: 'Rate limit exceeded',
  errorStack: 'Error: Rate limit exceeded\n  at sync.ts:42',
  attempts: 5,
  status: 'failed',
  createdAt: 1700000000000,
  updatedAt: 1700000000000
}

describe('AdminQueuesList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty message when no jobs are present', () => {
    render(<AdminQueuesList jobs={[]} />)
    expect(screen.getByText('No dead-lettered jobs found.')).toBeDefined()
  })

  it('renders job summary and toggles details', () => {
    render(<AdminQueuesList jobs={[sampleJob]} />)

    expect(screen.getByText('syncProfile')).toBeDefined()
    expect(screen.getByText('Rate limit exceeded')).toBeDefined()
    expect(screen.getByText('Attempts: 5')).toBeDefined()

    // Details are initially collapsed
    expect(screen.queryByText('Error Stack Trace')).toBeNull()

    // Click details button to expand
    fireEvent.click(screen.getByRole('button', { name: /details/i }))

    expect(screen.getByText('Error Stack Trace')).toBeDefined()
    expect(screen.getByText(/sync\.ts:42/)).toBeDefined()

    // Click again to collapse
    fireEvent.click(
      screen.getByRole('button', { name: /collapse job details/i })
    )
    expect(screen.queryByText('Error Stack Trace')).toBeNull()
  })

  it('triggers retry action', async () => {
    render(<AdminQueuesList jobs={[sampleJob]} />)

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryBtn)
    await vi.waitFor(() => {
      expect(retryDeadLetterJob).toHaveBeenCalledWith('job-123')
    })
  })

  it('triggers discard action', async () => {
    render(<AdminQueuesList jobs={[sampleJob]} />)

    const discardBtn = screen.getByRole('button', { name: /discard/i })
    fireEvent.click(discardBtn)
    await vi.waitFor(() => {
      expect(discardDeadLetterJob).toHaveBeenCalledWith('job-123')
    })
  })
})

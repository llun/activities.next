/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteSelectedDeadLetterJobs,
  discardDeadLetterJob,
  retryDeadLetterJob,
  retrySelectedDeadLetterJobs
} from '@/app/(timeline)/admin/queues/actions'
import { DeadLetterJob } from '@/lib/types/database/operations'

import { AdminQueuesList } from './AdminQueuesList'

vi.mock('@/app/(timeline)/admin/queues/actions', () => ({
  retryDeadLetterJob: vi.fn().mockResolvedValue({ success: true }),
  discardDeadLetterJob: vi.fn().mockResolvedValue({ success: true }),
  retrySelectedDeadLetterJobs: vi.fn().mockResolvedValue({ success: true }),
  deleteSelectedDeadLetterJobs: vi.fn().mockResolvedValue({ success: true })
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
    await act(async () => {
      fireEvent.click(retryBtn)
    })
    await vi.waitFor(() => {
      expect(retryDeadLetterJob).toHaveBeenCalledWith('job-123')
    })
  })

  it('triggers discard action', async () => {
    render(<AdminQueuesList jobs={[sampleJob]} />)

    const discardBtn = screen.getByRole('button', { name: /discard/i })
    await act(async () => {
      fireEvent.click(discardBtn)
    })
    await vi.waitFor(() => {
      expect(discardDeadLetterJob).toHaveBeenCalledWith('job-123')
    })
  })

  it('selects all jobs and triggers selective retry', async () => {
    const job2 = { ...sampleJob, id: 'job-456', jobName: 'job2' }
    render(<AdminQueuesList jobs={[sampleJob, job2]} />)

    const selectAllCheckbox = screen.getByRole('checkbox', {
      name: /select all jobs/i
    })
    await act(async () => {
      fireEvent.click(selectAllCheckbox)
    })

    expect(screen.getByText('2 of 2 selected')).toBeDefined()

    const retrySelectedBtn = screen.getByRole('button', {
      name: /retry selected \(2\)/i
    })
    await act(async () => {
      fireEvent.click(retrySelectedBtn)
    })

    await vi.waitFor(() => {
      expect(retrySelectedDeadLetterJobs).toHaveBeenCalledWith([
        'job-123',
        'job-456'
      ])
    })
  })

  it('selects single job and triggers selective delete with confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminQueuesList jobs={[sampleJob]} />)

    const jobCheckbox = screen.getByRole('checkbox', {
      name: /select job syncProfile/i
    })
    await act(async () => {
      fireEvent.click(jobCheckbox)
    })

    expect(screen.getByText('1 of 1 selected')).toBeDefined()

    const deleteSelectedBtn = screen.getByRole('button', {
      name: /delete selected \(1\)/i
    })
    await act(async () => {
      fireEvent.click(deleteSelectedBtn)
    })

    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to delete 1 selected job?'
    )
    await vi.waitFor(() => {
      expect(deleteSelectedDeadLetterJobs).toHaveBeenCalledWith(['job-123'])
    })
  })
})

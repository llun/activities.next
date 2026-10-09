/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('renders an empty state when no jobs are present', () => {
    render(<AdminQueuesList jobs={[]} />)
    expect(screen.getByText('No dead-lettered jobs found.')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists the jobs in a table of job, status, attempts and updated', () => {
    const retried = {
      ...sampleJob,
      id: 'job-456',
      jobName: 'sendMail',
      status: 'retried' as const,
      attempts: 2
    }
    render(<AdminQueuesList jobs={[sampleJob, retried]} />)

    const table = screen.getByRole('table', { name: 'Dead-lettered jobs' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual(['', 'Job', 'Status', 'Attempts', 'Updated', 'Actions'])
    const [, failedRow, retriedRow] = within(table).getAllByRole('row')
    expect(within(failedRow).getByText('syncProfile')).toBeDefined()
    expect(within(failedRow).getByText('Rate limit exceeded')).toBeDefined()
    // Status, attempts and updated are columns of their own (the phone folds
    // them into a second line under the job, which is hidden from `sm`).
    const failedCells = within(failedRow).getAllByRole('cell')
    expect(failedCells[2].textContent).toBe('failed')
    expect(failedCells[3].textContent).toBe('5')
    // A retried job can be neither retried nor discarded again.
    expect(within(retriedRow).getAllByRole('cell')[2].textContent).toBe(
      'retried'
    )
    expect(
      within(retriedRow).queryByRole('button', { name: /retry/i })
    ).toBeNull()
    expect(
      within(retriedRow).queryByRole('button', { name: /discard/i })
    ).toBeNull()
  })

  it('drops a selected job that is no longer listed after the list refreshes', () => {
    const job2 = { ...sampleJob, id: 'job-456', jobName: 'job2' }
    const { rerender } = render(<AdminQueuesList jobs={[sampleJob, job2]} />)

    fireEvent.click(
      screen.getByRole('checkbox', { name: /select job syncProfile/i })
    )
    expect(screen.getByText('1 of 2 selected')).toBeDefined()

    // A Refresh brings the page back without the selected job.
    rerender(<AdminQueuesList jobs={[job2]} />)

    expect(screen.queryByText(/of 1 selected/)).toBeNull()
    expect(screen.getByText('1 job on this page')).toBeDefined()
    expect(screen.queryByRole('button', { name: /retry selected/i })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /delete selected/i })
    ).toBeNull()
  })

  it('does not act on a job the refreshed list no longer shows', async () => {
    const job2 = { ...sampleJob, id: 'job-456', jobName: 'job2' }
    const { rerender } = render(<AdminQueuesList jobs={[sampleJob, job2]} />)

    fireEvent.click(
      screen.getByRole('checkbox', { name: /select job syncProfile/i })
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /select job job2/i }))
    rerender(<AdminQueuesList jobs={[job2]} />)

    expect(screen.getByText('1 of 1 selected')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry selected/i }))
    })
    expect(retrySelectedDeadLetterJobs).toHaveBeenCalledWith(['job-456'])
  })

  it('keeps a long payload line inside the frame, scrolling in its own block', () => {
    const long = {
      ...sampleJob,
      payload: {
        ...sampleJob.payload,
        data: { actorId: `https://host.example/users/${'x'.repeat(300)}` }
      }
    }
    render(<AdminQueuesList jobs={[long]} />)

    fireEvent.click(screen.getByRole('button', { name: /details/i }))

    // The details sit in a block that takes its width from the table, not from
    // the payload, so the line scrolls in the <pre> instead of widening the
    // table and pushing every row's actions out of view.
    const block = document.querySelector('[data-slot="job-details"]')!
    expect(block.querySelector('pre')).not.toBeNull()
    expect(block.parentElement?.tagName).toBe('TD')
    expect(block.querySelector('pre')?.textContent).toContain('x'.repeat(300))
  })

  it('names the toggle by its visible text and the job, with its state', () => {
    render(<AdminQueuesList jobs={[sampleJob]} />)

    const toggle = screen.getByRole('button', {
      name: /^Details\s*for syncProfile$/
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(
      screen
        .getByRole('button', { name: /^Less\s*for syncProfile$/ })
        .getAttribute('aria-expanded')
    ).toBe('true')
  })

  it('renders job summary and toggles details', () => {
    render(<AdminQueuesList jobs={[sampleJob]} />)

    expect(screen.getByText('syncProfile')).toBeDefined()
    expect(screen.getByText('Rate limit exceeded')).toBeDefined()

    // Details are initially collapsed
    expect(screen.queryByText('Error stack trace')).toBeNull()

    // Click details button to expand
    fireEvent.click(screen.getByRole('button', { name: /details/i }))

    expect(screen.getByText('Error stack trace')).toBeDefined()
    expect(screen.getByText(/sync\.ts:42/)).toBeDefined()

    // Click again to collapse
    fireEvent.click(screen.getByRole('button', { name: /^less/i }))
    expect(screen.queryByText('Error stack trace')).toBeNull()
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

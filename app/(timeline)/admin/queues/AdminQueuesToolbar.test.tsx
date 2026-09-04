/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDiscardedJobs,
  dropAllDeadLetterJobs,
  retryAllDeadLetterJobs
} from '@/app/(timeline)/admin/queues/actions'

import { AdminQueuesToolbar } from './AdminQueuesToolbar'

vi.mock('@/app/(timeline)/admin/queues/actions', () => ({
  retryAllDeadLetterJobs: vi.fn().mockResolvedValue({ success: true }),
  clearDiscardedJobs: vi.fn().mockResolvedValue({ success: true }),
  dropAllDeadLetterJobs: vi.fn().mockResolvedValue({ success: true })
}))

describe('AdminQueuesToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders nothing when all counts are 0', () => {
    const { container } = render(
      <AdminQueuesToolbar allCount={0} failedCount={0} discardedCount={0} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders retry all button when failedCount > 0 and calls action', async () => {
    render(
      <AdminQueuesToolbar allCount={3} failedCount={3} discardedCount={0} />
    )

    const retryBtn = screen.getByRole('button', {
      name: /retry all failed \(3\)/i
    })
    expect(retryBtn).toBeDefined()

    await act(async () => {
      fireEvent.click(retryBtn)
    })
    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to retry all failed jobs?'
    )
    expect(retryAllDeadLetterJobs).toHaveBeenCalledTimes(1)
  })

  it('renders clear discarded button when discardedCount > 0 and calls action', async () => {
    render(
      <AdminQueuesToolbar allCount={2} failedCount={0} discardedCount={2} />
    )

    const clearBtn = screen.getByRole('button', {
      name: /clear discarded \(2\)/i
    })
    expect(clearBtn).toBeDefined()

    await act(async () => {
      fireEvent.click(clearBtn)
    })
    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to permanently delete all discarded jobs?'
    )
    expect(clearDiscardedJobs).toHaveBeenCalledTimes(1)
  })

  it('renders drop all messages button when allCount > 0 and calls action', async () => {
    render(
      <AdminQueuesToolbar allCount={5} failedCount={3} discardedCount={2} />
    )

    const dropBtn = screen.getByRole('button', {
      name: /drop all messages \(5\)/i
    })
    expect(dropBtn).toBeDefined()

    await act(async () => {
      fireEvent.click(dropBtn)
    })
    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to permanently drop all messages in the dead letter queue?'
    )
    expect(dropAllDeadLetterJobs).toHaveBeenCalledTimes(1)
  })

  it('does not invoke dropAllDeadLetterJobs when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <AdminQueuesToolbar allCount={5} failedCount={3} discardedCount={2} />
    )

    const dropBtn = screen.getByRole('button', {
      name: /drop all messages \(5\)/i
    })
    await act(async () => {
      fireEvent.click(dropBtn)
    })

    expect(window.confirm).toHaveBeenCalled()
    expect(dropAllDeadLetterJobs).not.toHaveBeenCalled()
  })
})

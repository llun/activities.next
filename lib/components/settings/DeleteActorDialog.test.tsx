/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { deleteActor } from '@/lib/client'

import { DeleteActorDialog } from './DeleteActorDialog'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    refresh: mockRefresh
  }))
}))

vi.mock('@/lib/client', () => ({
  deleteActor: vi.fn()
}))

describe('DeleteActorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog with actor username and domain', () => {
    render(
      <DeleteActorDialog
        open={true}
        onOpenChange={vi.fn()}
        actorId="actor-1"
        actorUsername="alice"
        actorDomain="activities.local"
      />
    )

    expect(screen.getByText('@alice@activities.local')).toBeInTheDocument()
    expect(screen.getByText('Delete Actor')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Schedule Deletion' })
    ).toBeInTheDocument()
  })

  it('schedules delayed deletion by default and refreshes', async () => {
    const onOpenChange = vi.fn()
    vi.mocked(deleteActor).mockResolvedValueOnce({
      actorId: 'actor-1',
      status: 'scheduled',
      scheduledAt: '2026-09-10T00:00:00.000Z',
      immediate: false
    })

    render(
      <DeleteActorDialog
        open={true}
        onOpenChange={onOpenChange}
        actorId="actor-1"
        actorUsername="alice"
        actorDomain="activities.local"
      />
    )

    const scheduleButton = screen.getByRole('button', {
      name: 'Schedule Deletion'
    })
    fireEvent.click(scheduleButton)

    expect(deleteActor).toHaveBeenCalledWith({
      actorId: 'actor-1',
      delayDays: 3
    })

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('deletes immediately when immediate option is selected', async () => {
    const onOpenChange = vi.fn()
    vi.mocked(deleteActor).mockResolvedValueOnce({
      actorId: 'actor-1',
      status: 'scheduled',
      scheduledAt: null,
      immediate: true
    })

    render(
      <DeleteActorDialog
        open={true}
        onOpenChange={onOpenChange}
        actorId="actor-1"
        actorUsername="alice"
        actorDomain="activities.local"
      />
    )

    const immediateRadio = screen.getByLabelText('Delete immediately')
    fireEvent.click(immediateRadio)

    const deleteButton = screen.getByRole('button', {
      name: 'Delete Now'
    })
    fireEvent.click(deleteButton)

    expect(deleteActor).toHaveBeenCalledWith({
      actorId: 'actor-1',
      delayDays: 0
    })

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('displays error message when deleteActor fails', async () => {
    vi.mocked(deleteActor).mockRejectedValueOnce(
      new Error('Cannot delete the default actor')
    )

    render(
      <DeleteActorDialog
        open={true}
        onOpenChange={vi.fn()}
        actorId="actor-1"
        actorUsername="alice"
        actorDomain="activities.local"
      />
    )

    const scheduleButton = screen.getByRole('button', {
      name: 'Schedule Deletion'
    })
    fireEvent.click(scheduleButton)

    await waitFor(() => {
      expect(
        screen.getByText('Cannot delete the default actor')
      ).toBeInTheDocument()
    })
  })
})

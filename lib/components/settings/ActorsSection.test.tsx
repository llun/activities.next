/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { cancelActorDeletion, setDefaultActor, switchActor } from '@/lib/client'

import { ActorsSection } from './ActorsSection'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    refresh: mockRefresh
  }))
}))

vi.mock('@/lib/components/actor-switcher', () => ({
  AddActorDialog: () => null
}))

vi.mock('@/lib/client', () => ({
  cancelActorDeletion: vi.fn(),
  setDefaultActor: vi.fn(),
  switchActor: vi.fn()
}))

describe('ActorsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const actors = [
    {
      id: 'actor-1',
      username: 'alice',
      domain: 'activities.local',
      name: 'Alice'
    },
    {
      id: 'actor-2',
      username: 'bob',
      domain: 'activities.local',
      name: 'Bob'
    }
  ]

  const scheduledActor = {
    id: 'actor-3',
    username: 'charlie',
    domain: 'activities.local',
    name: 'Charlie',
    deletionStatus: 'scheduled' as const
  }

  const deletingActor = {
    id: 'actor-4',
    username: 'dave',
    domain: 'activities.local',
    name: 'Dave',
    deletionStatus: 'deleting' as const
  }

  it('shows the current actor after reload even when default differs', () => {
    render(
      <ActorsSection
        currentActor={actors[1]}
        actors={actors}
        currentDefault={actors[0].id}
      />
    )

    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('(current)')).toBeInTheDocument()
  })

  it('falls back to the first actor when current actor is missing', () => {
    render(
      <ActorsSection
        currentActor={{
          id: 'missing-actor',
          username: 'charlie',
          domain: 'activities.local',
          name: 'Charlie'
        }}
        actors={actors}
        currentDefault={actors[0].id}
      />
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('(current)')).not.toBeInTheDocument()
  })

  it('renders pending deletion status and an enabled cancel button in dropdown', async () => {
    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    expect(screen.getByText('Pending deletion')).toBeInTheDocument()

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeInTheDocument()
    expect(cancelButton).not.toBeDisabled()

    const menuItems = screen.getAllByRole('menuitem')
    const scheduledItem = menuItems.find((item) =>
      item.textContent?.includes('Charlie')
    )
    expect(scheduledItem).toBeDefined()
    expect(scheduledItem).not.toHaveAttribute('aria-disabled', 'true')
    expect(scheduledItem).not.toHaveAttribute('data-disabled')
  })

  it('cancels deletion and refreshes route on cancel button click', async () => {
    vi.mocked(cancelActorDeletion).mockResolvedValue({
      actorId: 'actor-3',
      status: 'cancelled'
    })

    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)

    expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('does not switch selected actor when clicking the scheduled item row and instead cancels deletion', async () => {
    vi.mocked(cancelActorDeletion).mockResolvedValue({
      actorId: 'actor-3',
      status: 'cancelled'
    })

    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const charlieText = screen.getByText('Charlie')
    fireEvent.click(charlieText)

    // Trigger still displays Alice (current actor not changed)
    expect(trigger).toHaveTextContent('Alice')
    expect(switchActor).not.toHaveBeenCalled()
    expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('cancels deletion via keyboard selection of scheduled actor row', async () => {
    vi.mocked(cancelActorDeletion).mockResolvedValue({
      actorId: 'actor-3',
      status: 'cancelled'
    })

    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const menuItems = screen.getAllByRole('menuitem')
    const scheduledItem = menuItems.find((item) =>
      item.textContent?.includes('Charlie')
    )
    expect(scheduledItem).toBeDefined()

    fireEvent.keyDown(scheduledItem!, { key: 'Enter' })

    expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
    expect(switchActor).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('prevents duplicate cancel requests until refreshed state arrives', async () => {
    vi.mocked(cancelActorDeletion).mockResolvedValue({
      actorId: 'actor-3',
      status: 'cancelled'
    })

    const { rerender } = render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toHaveAttribute('type', 'button')

    // First cancel click
    fireEvent.click(cancelButton)

    expect(cancelActorDeletion).toHaveBeenCalledTimes(1)
    expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })

    // Duplicate cancel click before refreshed state arrives
    fireEvent.click(cancelButton)
    expect(cancelActorDeletion).toHaveBeenCalledTimes(1)

    // Selecting row also does not send duplicate cancel
    const charlieText = screen.getByText('Charlie')
    fireEvent.click(charlieText)
    expect(cancelActorDeletion).toHaveBeenCalledTimes(1)

    // Refreshed state arrives from server
    rerender(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], { ...scheduledActor, deletionStatus: null }]}
        currentDefault={actors[0].id}
      />
    )

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()
  })

  it('sets explicit type="button" on all action buttons and cancel button', async () => {
    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Switch to actor' })
    ).toHaveAttribute('type', 'button')
    expect(
      screen.getByRole('button', { name: 'Set as default' })
    ).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'Add actor' })).toHaveAttribute(
      'type',
      'button'
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    expect(trigger).toHaveAttribute('type', 'button')

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'type',
      'button'
    )
  })

  it('surfaces error message when cancelActorDeletion fails', async () => {
    vi.mocked(cancelActorDeletion).mockRejectedValueOnce(
      new Error('Cancellation failed')
    )

    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], scheduledActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)

    expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
    expect(mockRefresh).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText('Cancellation failed')).toBeInTheDocument()
    })
  })

  it('disables menu item for actor with deleting status', async () => {
    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={[actors[0], deletingActor]}
        currentDefault={actors[0].id}
      />
    )

    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    expect(screen.getByText('Deleting...')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()

    const menuItems = screen.getAllByRole('menuitem')
    const deletingItem = menuItems.find((item) =>
      item.textContent?.includes('Dave')
    )
    expect(deletingItem).toBeDefined()
    expect(deletingItem).toHaveAttribute('data-disabled')
    expect(deletingItem).toHaveAttribute('aria-disabled', 'true')
  })

  it('updates default actor via setDefaultActor and refreshes', async () => {
    vi.mocked(setDefaultActor).mockResolvedValue({
      defaultActorId: 'actor-2',
      id: 'actor-2',
      username: 'bob',
      domain: 'activities.local'
    })

    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={actors}
        currentDefault={actors[0].id}
      />
    )

    // Select Bob from dropdown
    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const bobItem = screen.getByText('Bob')
    fireEvent.click(bobItem)

    const saveDefaultButton = screen.getByRole('button', {
      name: 'Set as default'
    })
    expect(saveDefaultButton).not.toBeDisabled()
    fireEvent.click(saveDefaultButton)

    expect(setDefaultActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
    await waitFor(() => {
      expect(screen.getByText('Default actor updated')).toBeInTheDocument()
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('displays error message when setDefaultActor fails', async () => {
    vi.mocked(setDefaultActor).mockRejectedValueOnce(
      new Error('Failed to update')
    )

    render(
      <ActorsSection
        currentActor={actors[0]}
        actors={actors}
        currentDefault={actors[0].id}
      />
    )

    // Select Bob from dropdown
    const trigger = screen.getByRole('button', { name: /alice/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menu')

    const bobItem = screen.getByText('Bob')
    fireEvent.click(bobItem)

    const saveDefaultButton = screen.getByRole('button', {
      name: 'Set as default'
    })
    fireEvent.click(saveDefaultButton)

    expect(setDefaultActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
    await waitFor(() => {
      expect(
        screen.getByText('Failed to update default actor')
      ).toBeInTheDocument()
    })
  })
})

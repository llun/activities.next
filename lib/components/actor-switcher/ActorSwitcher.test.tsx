/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { cancelActorDeletion, switchActor } from '@/lib/client'

import { ActorSwitcher } from './ActorSwitcher'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    refresh: mockRefresh
  }))
}))

vi.mock('@/lib/client', () => ({
  switchActor: vi.fn(),
  cancelActorDeletion: vi.fn()
}))

const mockAddActorDialog = vi.fn()
vi.mock('./AddActorDialog', () => ({
  AddActorDialog: (props: unknown) => {
    mockAddActorDialog(props)
    return null
  }
}))

const alice = {
  id: 'actor-1',
  username: 'alice',
  domain: 'activities.local',
  name: 'Alice'
}
const bob = {
  id: 'actor-2',
  username: 'bob',
  domain: 'activities.local',
  name: 'Bob'
}
const scheduledActor = {
  id: 'actor-3',
  username: 'charlie',
  domain: 'activities.local',
  name: 'Charlie',
  deletionStatus: 'scheduled'
}
const deletingActor = {
  id: 'actor-4',
  username: 'dave',
  domain: 'activities.local',
  name: 'Dave',
  deletionStatus: 'deleting'
}

const profileHref = '/@alice@activities.local'

describe('ActorSwitcher', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.mocked(switchActor).mockReset()
    vi.mocked(cancelActorDeletion).mockReset()
    mockRefresh.mockReset()
    mockAddActorDialog.mockReset()

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: vi.fn() }
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  describe('with a single actor', () => {
    it('renders the whole row as a link to the profile without prefetch', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', profileHref)
      expect(link).toHaveAttribute('data-prefetch', 'false')
      expect(link).toHaveTextContent('Alice')
      expect(link).toHaveTextContent('@alice@activities.local')
    })

    it('does not render the actor-list dropdown trigger', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('does not render the chevron arrow', () => {
      const { container } = render(
        <ActorSwitcher currentActor={alice} actors={[alice]} />
      )

      expect(
        container.querySelector('.lucide-chevron-down')
      ).not.toBeInTheDocument()
    })
  })

  describe('with multiple actors', () => {
    it('links only the avatar icon to the profile without prefetch', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const iconLink = screen.getByRole('link', {
        name: "View Alice's profile"
      })
      expect(iconLink).toHaveAttribute('href', profileHref)
      expect(iconLink).toHaveAttribute('data-prefetch', 'false')
    })

    it('renders the name/handle/arrow as the dropdown trigger, not a link', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button')
      expect(trigger).toHaveTextContent('Alice')
      expect(trigger).toHaveTextContent('@alice@activities.local')
      expect(trigger.querySelector('.lucide-chevron-down')).toBeInTheDocument()

      const profileLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === profileHref)
      expect(profileLinks).toHaveLength(1)
      expect(profileLinks[0]).not.toHaveTextContent('Alice')
    })

    it('switches actor and reloads page on successful selection', async () => {
      vi.mocked(switchActor).mockResolvedValue(true)
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const bobItem = screen.getByText('Bob')
      fireEvent.click(bobItem)

      expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
      await waitFor(() => {
        expect(window.location.reload).toHaveBeenCalled()
      })
    })

    it('surfaces error feedback when switchActor returns false, survives dropdown closure, and succeeds on retry', async () => {
      vi.mocked(switchActor).mockResolvedValueOnce(false)
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const bobItem = screen.getByText('Bob')
      fireEvent.click(bobItem)

      expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
      expect(window.location.reload).not.toHaveBeenCalled()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Failed to switch actor')

      // Dropdown closes on selection; verify error persists after closure
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to switch actor'
      )

      // Retry: reopen dropdown and select actor again
      vi.mocked(switchActor).mockResolvedValueOnce(true)
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const retryBobItem = screen.getByText('Bob')
      fireEvent.click(retryBobItem)

      expect(switchActor).toHaveBeenCalledTimes(2)
      await waitFor(() => {
        expect(window.location.reload).toHaveBeenCalled()
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('surfaces error feedback without unhandled rejection when switchActor rejects, and succeeds on retry', async () => {
      vi.mocked(switchActor).mockRejectedValueOnce(
        new Error('Network disconnected')
      )
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const bobItem = screen.getByText('Bob')
      fireEvent.click(bobItem)

      expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
      expect(window.location.reload).not.toHaveBeenCalled()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Network disconnected')

      // Dropdown closes; retry after rejection
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })

      vi.mocked(switchActor).mockResolvedValueOnce(true)
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      fireEvent.click(screen.getByText('Bob'))
      await waitFor(() => {
        expect(window.location.reload).toHaveBeenCalled()
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not switch actor when clicking current actor', async () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const menuItems = screen.getAllByRole('menuitem')
      fireEvent.click(menuItems[0])

      expect(switchActor).not.toHaveBeenCalled()
    })

    it('does not switch actor if actor is scheduled for deletion', async () => {
      render(
        <ActorSwitcher currentActor={alice} actors={[alice, scheduledActor]} />
      )

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const scheduledItem = screen.getByText('Charlie')
      fireEvent.click(scheduledItem)
      expect(switchActor).not.toHaveBeenCalled()
    })

    it('does not switch actor if actor is deleting', async () => {
      render(
        <ActorSwitcher currentActor={alice} actors={[alice, deletingActor]} />
      )

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const deletingItem = screen.getByText('Dave')
      fireEvent.click(deletingItem)
      expect(switchActor).not.toHaveBeenCalled()
    })

    it('cancels deletion and refreshes route on cancel button click', async () => {
      vi.mocked(cancelActorDeletion).mockResolvedValue({
        actorId: 'actor-3',
        status: 'cancelled'
      })

      render(
        <ActorSwitcher currentActor={alice} actors={[alice, scheduledActor]} />
      )

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const cancelButton = screen.getByTitle('Cancel deletion')
      fireEvent.click(cancelButton)

      expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
      expect(switchActor).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('surfaces visible error feedback when cancel deletion fails, survives dropdown closure, and succeeds on retry', async () => {
      vi.mocked(cancelActorDeletion).mockRejectedValueOnce(
        new Error('Network error')
      )

      render(
        <ActorSwitcher currentActor={alice} actors={[alice, scheduledActor]} />
      )

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      const menu = await screen.findByRole('menu')

      const cancelButton = screen.getByTitle('Cancel deletion')
      fireEvent.click(cancelButton)

      expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
      expect(mockRefresh).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
          'Network error'
        )
      })

      // Close dropdown menu and verify visible error survives dropdown closure
      fireEvent.keyDown(menu, { key: 'Escape' })
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent('Network error')

      // Retry: reopen menu, retry button is enabled and retry succeeds
      vi.mocked(cancelActorDeletion).mockResolvedValueOnce({
        actorId: 'actor-3',
        status: 'cancelled'
      })

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const retryCancelButton = screen.getByTitle('Cancel deletion')
      expect(retryCancelButton).not.toBeDisabled()
      fireEvent.click(retryCancelButton)

      expect(cancelActorDeletion).toHaveBeenCalledTimes(2)
      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('opens add actor dialog when clicking add another actor item', async () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const addActorItem = screen.getByText('Add another actor')
      fireEvent.click(addActorItem)

      expect(mockAddActorDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true,
          domain: 'activities.local'
        })
      )
    })

    it('reloads page and closes dialog on successful actor creation', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const lastProps = mockAddActorDialog.mock.calls.at(-1)?.[0] as {
        onSuccess: () => void
      }
      lastProps.onSuccess()

      expect(window.location.reload).toHaveBeenCalled()
      expect(mockAddActorDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: false
        })
      )
    })
  })
})

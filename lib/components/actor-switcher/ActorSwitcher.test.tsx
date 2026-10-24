/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { cancelActorDeletion, switchActor } from '@/lib/client'
import { setActiveOfflineSession } from '@/lib/client/offline'
import {
  isProfileUnloadAllowed,
  setUnsavedProfileChanges
} from '@/lib/components/settings/profile/unsavedProfileChanges'

import { ActorSwitcher } from './ActorSwitcher'

vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default
}))

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

vi.mock('@/lib/client/offline', () => ({
  setActiveOfflineSession: vi.fn().mockResolvedValue(undefined)
}))

const mockAddActorDialog = vi.fn()
vi.mock('./AddActorDialog', () => ({
  AddActorDialog: (props: unknown) => {
    mockAddActorDialog(props)
    const { open } = (props as { open?: boolean }) || {}
    return open ? (
      <div data-testid="add-actor-dialog">Add actor dialog</div>
    ) : null
  }
}))

const mockSignOutDialog = vi.fn()
vi.mock('@/lib/components/sign-out/SignOutDialog', () => ({
  SignOutDialog: (props: unknown) => {
    mockSignOutDialog(props)
    const { open } = (props as { open?: boolean }) || {}
    return open ? (
      <div data-testid="sign-out-dialog">Sign out dialog</div>
    ) : null
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
    vi.mocked(setActiveOfflineSession).mockReset()
    mockRefresh.mockReset()
    mockAddActorDialog.mockReset()
    mockSignOutDialog.mockReset()

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
    it('renders a single button trigger that opens the menu with expected items and no switch profile list', async () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      expect(screen.queryByTestId('add-actor-dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sign-out-dialog')).not.toBeInTheDocument()
      expect(mockAddActorDialog).not.toHaveBeenCalled()
      expect(mockSignOutDialog).not.toHaveBeenCalled()

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      expect(trigger).toHaveTextContent('Alice')
      expect(trigger).toHaveTextContent('@alice@activities.local')
      expect(
        trigger.querySelector('.lucide-chevrons-up-down')
      ).toBeInTheDocument()

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      const menu = await screen.findByRole('menu')

      // 1. Header
      expect(menu).toHaveTextContent('Alice')
      expect(menu).toHaveTextContent('@alice@activities.local')

      // 3. View profile
      const viewProfile = screen.getByRole('menuitem', {
        name: /View profile/
      })
      expect(viewProfile).toHaveAttribute('href', profileHref)
      expect(viewProfile).toHaveAttribute('data-prefetch', 'false')

      // 4. Edit profile
      const editProfile = screen.getByRole('menuitem', {
        name: /Edit profile/
      })
      expect(editProfile).toHaveAttribute('href', '/settings/profile')
      expect(editProfile).toHaveAttribute('data-prefetch', 'false')

      // 7. Add another profile
      expect(
        screen.getByRole('menuitem', { name: /Add another profile/ })
      ).toBeInTheDocument()

      // 9. Account & security
      const accountLink = screen.getByRole('menuitem', {
        name: /Account & security/
      })
      expect(accountLink).toHaveAttribute('href', '/account')
      expect(accountLink).toHaveAttribute('data-prefetch', 'false')

      // 10. Sign out
      expect(
        screen.getByRole('menuitem', { name: /Sign out/ })
      ).toBeInTheDocument()

      // NO switch profile list
      expect(screen.queryByText('Switch profile')).not.toBeInTheDocument()
    })

    it('strips custom emoji shortcodes from trigger accessible name', () => {
      const flan = {
        ...alice,
        name: ':flan: Flan'
      }
      render(<ActorSwitcher currentActor={flan} actors={[flan]} />)

      expect(
        screen.getByRole('button', {
          name: 'Account menu for Flan'
        })
      ).toBeInTheDocument()
    })
  })

  describe('with multiple actors', () => {
    it('renders the whole row as the dropdown trigger, not a separate link', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      expect(trigger).toHaveTextContent('Alice')
      expect(trigger).toHaveTextContent('@alice@activities.local')
      expect(
        trigger.querySelector('.lucide-chevrons-up-down')
      ).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('shows Switch profile list with check on current actor and switches actor on selecting other', async () => {
      vi.mocked(switchActor).mockResolvedValue(true)
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      expect(screen.getByText('Switch profile')).toBeInTheDocument()

      const aliceItem = screen
        .getAllByRole('menuitem')
        .find(
          (item) =>
            item.textContent?.includes('Alice') &&
            item.textContent?.includes('@alice@activities.local')
        )
      expect(aliceItem?.querySelector('.lucide-check')).toBeInTheDocument()

      const bobItem = screen.getByText('Bob')
      fireEvent.click(bobItem)

      expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
      await waitFor(() => {
        expect(setActiveOfflineSession).toHaveBeenCalledWith({
          actorId: 'actor-2'
        })
        expect(window.location.reload).toHaveBeenCalled()
      })
    })

    describe('with unsaved Edit profile changes', () => {
      const pickBob = async () => {
        render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)
        fireEvent.keyDown(
          screen.getByRole('button', { name: 'Account menu for Alice' }),
          { key: 'ArrowDown' }
        )
        await screen.findByRole('menu')
        fireEvent.click(screen.getByText('Bob'))
      }

      afterEach(() => {
        setUnsavedProfileChanges(false)
        vi.restoreAllMocks()
      })

      it('does not switch when the person keeps editing', async () => {
        setUnsavedProfileChanges(true)
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        await pickBob()

        expect(confirm).toHaveBeenCalled()
        expect(switchActor).not.toHaveBeenCalled()
      })

      it('switches after the person agrees to discard', async () => {
        setUnsavedProfileChanges(true)
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        vi.mocked(switchActor).mockResolvedValue(true)
        await pickBob()

        expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
      })

      it('lets the reload through after Discard, and asks again if the switch fails', async () => {
        setUnsavedProfileChanges(true)
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        vi.mocked(switchActor).mockResolvedValue(false)
        await pickBob()

        await screen.findByText('Failed to switch profile')
        expect(isProfileUnloadAllowed()).toBe(false)
      })

      it('keeps the unload allowance while the switch goes ahead', async () => {
        setUnsavedProfileChanges(true)
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        vi.mocked(switchActor).mockResolvedValue(true)
        await pickBob()

        await waitFor(() => expect(window.location.reload).toHaveBeenCalled())
        expect(isProfileUnloadAllowed()).toBe(true)
      })

      it('does not ask when nothing is unsaved', async () => {
        const confirm = vi.spyOn(window, 'confirm')
        vi.mocked(switchActor).mockResolvedValue(true)
        await pickBob()

        expect(confirm).not.toHaveBeenCalled()
        expect(switchActor).toHaveBeenCalled()
      })
    })

    it('surfaces error feedback when switchActor returns false, survives dropdown closure, and succeeds on retry', async () => {
      vi.mocked(switchActor).mockResolvedValueOnce(false)
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const bobItem = screen.getByText('Bob')
      fireEvent.click(bobItem)

      expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
      expect(window.location.reload).not.toHaveBeenCalled()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Failed to switch profile')

      // Dropdown closes on selection; verify error persists after closure
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to switch profile'
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

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
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

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const aliceItem = screen
        .getAllByRole('menuitem')
        .find(
          (item) =>
            item.textContent?.includes('Alice') &&
            item.textContent?.includes('@alice@activities.local')
        )
      expect(aliceItem).toBeDefined()
      fireEvent.click(aliceItem!)

      expect(switchActor).not.toHaveBeenCalled()
    })

    it('does not switch actor if actor is scheduled for deletion and instead cancels deletion', async () => {
      vi.mocked(cancelActorDeletion).mockResolvedValue({
        actorId: 'actor-3',
        status: 'cancelled'
      })

      render(
        <ActorSwitcher currentActor={alice} actors={[alice, scheduledActor]} />
      )

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const scheduledItem = screen.getByText('Charlie')
      fireEvent.click(scheduledItem)
      expect(switchActor).not.toHaveBeenCalled()
      expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })
      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('cancels scheduled deletion on keyboard selection and does not silently close without action', async () => {
      vi.mocked(cancelActorDeletion).mockResolvedValue({
        actorId: 'actor-3',
        status: 'cancelled'
      })

      render(
        <ActorSwitcher currentActor={alice} actors={[alice, scheduledActor]} />
      )

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
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

    it('prevents duplicate cancel requests until refreshed state arrives and sets type="button"', async () => {
      vi.mocked(cancelActorDeletion).mockResolvedValue({
        actorId: 'actor-3',
        status: 'cancelled'
      })

      const { rerender } = render(
        <ActorSwitcher currentActor={alice} actors={[alice, scheduledActor]} />
      )

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const cancelButton = screen.getByTitle('Cancel deletion')
      expect(cancelButton).toHaveAttribute('type', 'button')

      // First cancel click
      fireEvent.click(cancelButton)

      expect(cancelActorDeletion).toHaveBeenCalledTimes(1)
      expect(cancelActorDeletion).toHaveBeenCalledWith({ actorId: 'actor-3' })

      // Duplicate cancel click before refreshed state arrives
      fireEvent.click(cancelButton)
      expect(cancelActorDeletion).toHaveBeenCalledTimes(1)

      // Also selecting the row while cancellation is in progress does not send duplicate cancel
      const scheduledItem = screen.getByText('Charlie')
      fireEvent.click(scheduledItem)
      expect(cancelActorDeletion).toHaveBeenCalledTimes(1)

      // Refreshed state arrives from server
      rerender(
        <ActorSwitcher
          currentActor={alice}
          actors={[alice, { ...scheduledActor, deletionStatus: null }]}
        />
      )

      // Reopen menu: Charlie is no longer pending deletion
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')
      expect(screen.queryByTitle('Cancel deletion')).not.toBeInTheDocument()
    })

    it('does not switch actor if actor is deleting', async () => {
      render(
        <ActorSwitcher currentActor={alice} actors={[alice, deletingActor]} />
      )

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
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

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
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

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
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

    it('opens add actor dialog when clicking add another profile item', async () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      expect(screen.queryByTestId('add-actor-dialog')).not.toBeInTheDocument()
      expect(mockAddActorDialog).not.toHaveBeenCalled()

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const addActorItem = screen.getByRole('menuitem', {
        name: /Add another profile/
      })
      expect(screen.queryByTestId('add-actor-dialog')).not.toBeInTheDocument()
      expect(mockAddActorDialog).not.toHaveBeenCalled()

      fireEvent.click(addActorItem)

      // Opened once the menu has closed, so it is not dismissed with it.
      expect(await screen.findByTestId('add-actor-dialog')).toBeInTheDocument()
      expect(mockAddActorDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          open: true,
          domain: 'activities.local',
          onCloseAutoFocus: expect.any(Function)
        })
      )

      const lastProps = mockAddActorDialog.mock.calls.at(-1)?.[0] as {
        onCloseAutoFocus: (e: Event) => void
      }
      const focusEvent = new Event('focus')
      const preventDefault = vi.spyOn(focusEvent, 'preventDefault')
      lastProps.onCloseAutoFocus(focusEvent)
      expect(preventDefault).toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger)
    })

    it('reloads page and closes dialog on successful actor creation', async () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      expect(screen.queryByTestId('add-actor-dialog')).not.toBeInTheDocument()
      expect(mockAddActorDialog).not.toHaveBeenCalled()

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const addActorItem = screen.getByRole('menuitem', {
        name: /Add another profile/
      })
      fireEvent.click(addActorItem)

      expect(await screen.findByTestId('add-actor-dialog')).toBeInTheDocument()
      expect(mockAddActorDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true
        })
      )

      const lastProps = mockAddActorDialog.mock.calls.at(-1)?.[0] as {
        onSuccess: () => void
      }
      act(() => {
        lastProps.onSuccess()
      })

      expect(window.location.reload).toHaveBeenCalled()
      await waitFor(() =>
        expect(mockAddActorDialog).toHaveBeenLastCalledWith(
          expect.objectContaining({
            open: false
          })
        )
      )
      expect(screen.queryByTestId('add-actor-dialog')).not.toBeInTheDocument()
    })

    it('says the sign-out dialog could not load instead of breaking the page', async () => {
      // A deploy under an open tab (or being offline) leaves the chunk missing.
      mockSignOutDialog.mockImplementation(() => {
        const error = new Error('Loading chunk 123 failed.')
        error.name = 'ChunkLoadError'
        throw error
      })
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')
      fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }))

      expect(await screen.findByText("Couldn't load")).toBeInTheDocument()
      expect(
        screen.getByText('Reload the page to try again.')
      ).toBeInTheDocument()
      // The menu itself keeps working.
      expect(
        screen.getByRole('button', { name: 'Account menu for Alice' })
      ).toBeInTheDocument()
      consoleError.mockRestore()
    })

    it('opens SignOutDialog when selecting Sign out', async () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      expect(screen.queryByTestId('sign-out-dialog')).not.toBeInTheDocument()
      expect(mockSignOutDialog).not.toHaveBeenCalled()

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const signOutItem = screen.getByRole('menuitem', { name: /Sign out/ })
      expect(screen.queryByTestId('sign-out-dialog')).not.toBeInTheDocument()
      expect(mockSignOutDialog).not.toHaveBeenCalled()

      fireEvent.click(signOutItem)
      expect(await screen.findByTestId('sign-out-dialog')).toBeInTheDocument()
      expect(mockSignOutDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          open: true,
          onCloseAutoFocus: expect.any(Function)
        })
      )

      const lastProps = mockSignOutDialog.mock.calls.at(-1)?.[0] as {
        onCloseAutoFocus: (e: Event) => void
      }
      const focusEvent = new Event('focus')
      const preventDefault = vi.spyOn(focusEvent, 'preventDefault')
      lastProps.onCloseAutoFocus(focusEvent)
      expect(preventDefault).toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger)
    })

    it.each([
      ['multiple actors', [alice, bob]],
      ['a single actor', [alice]]
    ])(
      'invokes onNavigate when clicking View profile link with %s',
      async (_label, actors) => {
        const onNavigate = vi.fn()
        render(
          <ActorSwitcher
            currentActor={alice}
            actors={actors}
            onNavigate={onNavigate}
          />
        )

        const trigger = screen.getByRole('button', {
          name: 'Account menu for Alice'
        })
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
        const viewProfile = await screen.findByRole('menuitem', {
          name: /View profile/
        })
        fireEvent.click(viewProfile)
        expect(onNavigate).toHaveBeenCalledTimes(1)
      }
    )
  })

  describe('rail variant', () => {
    it('renders avatar as trigger and opens menu with side="right"', async () => {
      render(
        <ActorSwitcher currentActor={alice} actors={[alice]} variant="rail" />
      )

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Alice'
      })
      expect(trigger).toHaveClass('rounded-full')
      expect(trigger).not.toHaveTextContent('Alice')
      expect(
        trigger.querySelector('.lucide-chevrons-up-down')
      ).not.toBeInTheDocument()

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      const menu = await screen.findByRole('menu')
      expect(menu).toHaveAttribute('data-side', 'right')
    })
  })

  describe('user fallback', () => {
    it('renders account menu and links View profile to /${user.handle} when only user is passed', async () => {
      const user = {
        name: 'Eve User',
        username: 'eve',
        handle: '@eve@activities.local',
        avatarUrl: 'https://example.com/eve.png'
      }
      render(<ActorSwitcher user={user} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Eve User'
      })
      expect(trigger).toHaveTextContent('Eve User')
      expect(trigger).toHaveTextContent('@eve@activities.local')

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      const menu = await screen.findByRole('menu')

      expect(menu).toHaveTextContent('Eve User')
      const viewProfile = screen.getByRole('menuitem', {
        name: /View profile/
      })
      expect(viewProfile).toHaveAttribute('href', '/@eve@activities.local')
      expect(viewProfile).toHaveAttribute('data-prefetch', 'false')

      expect(
        screen.getByRole('menuitem', { name: /Edit profile/ })
      ).toHaveAttribute('href', '/settings/profile')
      expect(
        screen.getByRole('menuitem', { name: /Account & security/ })
      ).toHaveAttribute('href', '/account')
      expect(
        screen.getByRole('menuitem', { name: /Sign out/ })
      ).toBeInTheDocument()
      expect(screen.queryByText('Switch profile')).not.toBeInTheDocument()
    })

    it('handles user handle without leading @', async () => {
      const user = {
        name: 'Eve User',
        username: 'eve',
        handle: 'eve@activities.local'
      }
      render(<ActorSwitcher user={user} />)

      const trigger = screen.getByRole('button', {
        name: 'Account menu for Eve User'
      })
      expect(trigger).toHaveTextContent('@eve@activities.local')

      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findByRole('menu')

      const viewProfile = screen.getByRole('menuitem', {
        name: /View profile/
      })
      expect(viewProfile).toHaveAttribute('href', '/@eve@activities.local')
    })

    it('returns null when neither currentActor nor user is provided', () => {
      const { container } = render(<ActorSwitcher />)
      expect(container.firstChild).toBeNull()
    })
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { ReactElement } from 'react'

import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'
import { NavigationSettings } from '@/lib/components/settings/NavigationSettings'

const mockUpdate = vi.fn()
vi.mock('@/lib/client', () => ({
  updateNavigationPreferences: (input: unknown) => mockUpdate(input)
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>
}))

const renderSettings = (
  ui: ReactElement,
  preferences: { order?: string[]; hidden?: string[] } = {}
) =>
  render(
    <NavPreferencesProvider
      initialOrder={preferences.order}
      initialHidden={preferences.hidden}
    >
      {ui}
    </NavPreferencesProvider>
  )

// The item name is the row's first truncated label, ahead of any chip.
const rowLabels = () =>
  screen
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.truncate')?.textContent?.trim())

const rowFor = (label: string): HTMLElement => {
  const row = screen
    .getAllByRole('listitem')
    .find((candidate) => within(candidate).queryByText(label))
  if (!row) throw new Error(`No navigation row for ${label}`)
  return row
}

describe('NavigationSettings', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue(true)
  })

  it('lists the items this account can reach, with their descriptions', () => {
    renderSettings(<NavigationSettings fitnessUrl="/fitness" isAdmin />)

    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expect(
      screen.getByText('Posts from accounts you follow')
    ).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Fitness')).toBeInTheDocument()
  })

  it('leaves out items this account does not have', () => {
    renderSettings(<NavigationSettings />)

    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('Fitness')).not.toBeInTheDocument()
  })

  it('hides an item and marks the row', async () => {
    renderSettings(<NavigationSettings />)

    fireEvent.click(screen.getByRole('switch', { name: 'Show Favorites' }))

    expect(
      within(rowFor('Favorites')).getByText('under More')
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ navHidden: ['favorites'] })
      )
    )
  })

  it('shows a hidden item again', async () => {
    renderSettings(<NavigationSettings />, { hidden: ['favorites'] })

    fireEvent.click(screen.getByRole('switch', { name: 'Show Favorites' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ navHidden: [] })
      )
    )
  })

  it('pins an item that navigation cannot do without', () => {
    renderSettings(<NavigationSettings />)

    const row = rowFor('Settings')
    expect(within(row).getByText('Pinned')).toBeInTheDocument()
    expect(within(row).queryByRole('switch')).not.toBeInTheDocument()
  })

  it('explains an item the admin turned off and takes the toggle away', () => {
    renderSettings(
      <NavigationSettings fitnessUrl="/fitness" features={{ fitness: false }} />
    )

    const row = rowFor('Fitness')
    expect(within(row).getByText('off for this server')).toBeInTheDocument()
    expect(within(row).getByText('Admin')).toBeInTheDocument()
    expect(within(row).queryByRole('switch')).not.toBeInTheDocument()
    expect(row).toHaveAttribute('draggable', 'false')
  })

  it('reorders from the keyboard', async () => {
    renderSettings(<NavigationSettings />)

    fireEvent.keyDown(
      within(rowFor('Search')).getByRole('button', { name: /Reorder Search/ }),
      { key: 'ArrowUp' }
    )

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const [{ navOrder }] = mockUpdate.mock.calls[0]
    expect(navOrder.slice(0, 2)).toEqual(['search', 'timeline'])
  })

  it('moves past a hidden row rather than over it, because this list shows it', async () => {
    renderSettings(<NavigationSettings />, { hidden: ['explore'] })

    fireEvent.keyDown(
      within(rowFor('Search')).getByRole('button', { name: /Reorder Search/ }),
      { key: 'ArrowDown' }
    )

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const [{ navOrder }] = mockUpdate.mock.calls[0]
    // Explore is listed here — hidden or not — so Search swaps with it, which
    // is what dragging the same row does. (The sidebar's own menu skips over
    // hidden items instead: they are not on screen there.)
    expect(navOrder.slice(0, 4)).toEqual([
      'timeline',
      'explore',
      'search',
      'messages'
    ])
  })

  it('reorders a hidden row from the keyboard', async () => {
    renderSettings(<NavigationSettings />, { hidden: ['explore'] })

    fireEvent.keyDown(
      within(rowFor('Explore')).getByRole('button', {
        name: /Reorder Explore/
      }),
      { key: 'ArrowUp' }
    )

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const [{ navOrder }] = mockUpdate.mock.calls[0]
    expect(navOrder.slice(0, 3)).toEqual(['timeline', 'explore', 'search'])
  })

  it('says nothing moved at the end of the list', async () => {
    renderSettings(<NavigationSettings />)

    fireEvent.keyDown(
      within(rowFor('Timeline')).getByRole('button', {
        name: /Reorder Timeline/
      }),
      { key: 'ArrowUp' }
    )

    expect(await screen.findByText('Timeline is already first')).toBeVisible()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('announces where a moved row landed', async () => {
    renderSettings(<NavigationSettings />)

    fireEvent.keyDown(
      within(rowFor('Search')).getByRole('button', { name: /Reorder Search/ }),
      { key: 'ArrowUp' }
    )

    expect(
      await screen.findByText('Search moved up, position 1 of 10')
    ).toBeVisible()
  })

  it('repeats an announcement whose wording has not changed', async () => {
    renderSettings(<NavigationSettings />)

    const up = within(rowFor('Timeline')).getByRole('button', {
      name: 'Move Timeline up'
    })
    fireEvent.click(up)
    const firstAnnouncement = await screen.findByText(
      'Timeline is already first'
    )

    fireEvent.click(up)

    // Holding a move against the end of the list says the same sentence every
    // press, and a live region that does not change announces nothing — so the
    // node carrying it has to be replaced, not left in place.
    expect(firstAnnouncement).not.toBeInTheDocument()
    expect(screen.getByText('Timeline is already first')).toBeVisible()
  })

  it('announces a failed save, and nothing on a save that worked', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderSettings(<NavigationSettings />)

    // The caption changes twice per save and a keyboard reorder saves on every
    // keystroke, so it must not talk over each row's own announcement.
    expect(
      screen
        .getByText('Saved to your account settings as you change it.')
        .closest('[role="status"]')
    ).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: 'Show Favorites' }))

    const failure = await screen.findByText(/Couldn't save your changes/)
    expect(failure.closest('[role="status"]')).not.toBeNull()
  })

  it('reorders by dragging one row onto another', async () => {
    renderSettings(<NavigationSettings />)

    const dragged = rowFor('Settings')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(rowFor('Timeline'))
    // Nothing is written until the drop, so a drag across the list is one save.
    expect(mockUpdate).not.toHaveBeenCalled()
    fireEvent.drop(dragged)

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const [{ navOrder }] = mockUpdate.mock.calls[0]
    expect(navOrder[0]).toBe('settings')
  })

  it('puts the rows back when a drag is abandoned instead of dropped', async () => {
    renderSettings(<NavigationSettings />)

    const dragged = rowFor('Settings')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(rowFor('Timeline'))
    // Escape, or letting go outside the list, ends the drag without a drop.
    fireEvent.dragEnd(dragged)

    await act(async () => {})
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(rowLabels().slice(0, 2)).toEqual(['Timeline', 'Search'])
  })

  // Dragging needs a mouse and the grip's arrows need a keyboard, so without
  // these a phone can hide items but never reorder them.
  it('reorders from the row buttons, which need neither a mouse nor a keyboard', async () => {
    renderSettings(<NavigationSettings />)

    fireEvent.click(
      within(rowFor('Search')).getByRole('button', { name: 'Move Search up' })
    )

    expect(rowLabels().slice(0, 2)).toEqual(['Search', 'Timeline'])
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const [{ navOrder }] = mockUpdate.mock.calls[0]
    expect(navOrder.slice(0, 2)).toEqual(['search', 'timeline'])
  })

  it('offers no move past either end of the list', async () => {
    renderSettings(<NavigationSettings />)

    const up = within(rowFor('Timeline')).getByRole('button', {
      name: 'Move Timeline up'
    })
    expect(up).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(rowFor('Settings')).getByRole('button', {
        name: 'Move Settings down'
      })
    ).toHaveAttribute('aria-disabled', 'true')

    // Marked rather than disabled: a browser blurs a disabled element, which
    // would drop a keyboard user back to the top of the document mid-reorder.
    up.focus()
    fireEvent.click(up)
    await act(async () => {})

    expect(document.activeElement).toBe(up)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(await screen.findByText('Timeline is already first')).toBeVisible()
  })

  it('keeps focus on the button that moved a row to the end of the list', async () => {
    renderSettings(<NavigationSettings />)

    // Account sits second from last, so one press puts it last and its own
    // "Move down" becomes inert.
    const down = within(rowFor('Account')).getByRole('button', {
      name: 'Move Account down'
    })
    down.focus()
    fireEvent.click(down)
    await act(async () => {})

    expect(rowLabels().at(-1)).toBe('Account')
    expect(document.activeElement).toBe(down)
  })

  it('takes back an overshoot when the row is dragged over again', async () => {
    renderSettings(<NavigationSettings />)

    const dragged = rowFor('Timeline')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(rowFor('Search'))
    expect(rowLabels().slice(0, 2)).toEqual(['Search', 'Timeline'])

    // The dragged row now sits under the pointer; dragging back over Search
    // has to undo the swap rather than being swallowed as a repeat.
    fireEvent.dragOver(dragged)
    fireEvent.dragOver(rowFor('Search'))
    expect(rowLabels().slice(0, 2)).toEqual(['Timeline', 'Search'])

    fireEvent.drop(dragged)
    await act(async () => {})
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not let an abandoned drag revert a later, unrelated change', async () => {
    renderSettings(<NavigationSettings />)

    // Abandon a drag…
    const dragged = rowFor('Settings')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(rowFor('Timeline'))
    fireEvent.dragEnd(dragged)
    await act(async () => {})

    // …then reorder from the keyboard, which saves.
    fireEvent.keyDown(
      within(rowFor('Search')).getByRole('button', { name: /Reorder Search/ }),
      { key: 'ArrowUp' }
    )
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))

    // A stray dragend — one a row that cannot be dragged can still fire —
    // must not replay the order captured by that earlier drag.
    fireEvent.dragEnd(rowFor('Messages'))
    await act(async () => {})

    expect(rowLabels().slice(0, 2)).toEqual(['Search', 'Timeline'])
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('moves once per row crossed, however long the pointer rests there', async () => {
    renderSettings(<NavigationSettings />)

    const dragged = rowFor('Settings')
    fireEvent.dragStart(dragged)
    const target = rowFor('Timeline')
    // dragover repeats while the pointer is still; each one used to be a move.
    fireEvent.dragOver(target)
    fireEvent.dragOver(target)
    fireEvent.dragOver(target)
    fireEvent.drop(dragged)

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const [{ navOrder }] = mockUpdate.mock.calls[0]
    expect(navOrder[0]).toBe('settings')
  })

  it('carries the drag payload browsers require to start one', () => {
    renderSettings(<NavigationSettings />)

    const setData = vi.fn()
    fireEvent.dragStart(rowFor('Settings'), { dataTransfer: { setData } })

    expect(setData).toHaveBeenCalledWith('text/plain', 'settings')
  })

  it('resets to the shipped navigation', async () => {
    renderSettings(<NavigationSettings />, { hidden: ['favorites'] })

    fireEvent.click(screen.getByRole('button', { name: /Reset to defaults/ }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ navOrder: [], navHidden: [] })
    )
  })

  it('offers a retry when a save fails', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderSettings(<NavigationSettings />)

    fireEvent.click(screen.getByRole('switch', { name: 'Show Favorites' }))

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText(/Couldn't save your changes/)).toBeInTheDocument()

    mockUpdate.mockResolvedValue(true)
    fireEvent.click(retry)

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
  })
})

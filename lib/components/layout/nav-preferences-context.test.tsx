/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'

import {
  NavPreferencesProvider,
  useNavPreferences
} from '@/lib/components/layout/nav-preferences-context'
import { DEFAULT_NAV_ORDER } from '@/lib/services/navigation/navPreferences'

const mockUpdate = vi.fn()
vi.mock('@/lib/client', () => ({
  updateNavigationPreferences: (input: unknown) => mockUpdate(input)
}))

// Exercises the store through a bare consumer: the buttons stand in for the
// sidebar menu and the settings manager, which drive the same actions.
const Harness = () => {
  const {
    order,
    hidden,
    hideItem,
    showItem,
    moveTo,
    commit,
    reset,
    retry,
    saveState
  } = useNavPreferences()
  return (
    <div>
      <span data-testid="order">{order.join(',')}</span>
      <span data-testid="hidden">{hidden.join(',')}</span>
      <span data-testid="state">{saveState}</span>
      <button onClick={() => hideItem('favorites')}>hide favorites</button>
      <button onClick={() => hideItem('bookmarks')}>hide bookmarks</button>
      <button onClick={() => showItem('favorites')}>show favorites</button>
      <button onClick={() => moveTo('settings', 'timeline')}>drag</button>
      <button onClick={commit}>commit</button>
      <button onClick={reset}>reset</button>
      <button onClick={retry}>retry</button>
    </div>
  )
}

const renderStore = (props: { order?: string[]; hidden?: string[] } = {}) =>
  render(
    <NavPreferencesProvider
      initialOrder={props.order}
      initialHidden={props.hidden}
    >
      <Harness />
    </NavPreferencesProvider>
  )

const click = (name: string) => {
  act(() => {
    screen.getByRole('button', { name }).click()
  })
}

describe('NavPreferencesProvider', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue(true)
  })

  it('seeds from the saved settings', () => {
    renderStore({ order: ['settings', 'timeline'], hidden: ['favorites'] })

    expect(screen.getByTestId('order').textContent).toBe(
      [
        'settings',
        'timeline',
        ...DEFAULT_NAV_ORDER.filter(
          (id) => id !== 'settings' && id !== 'timeline'
        )
      ].join(',')
    )
    expect(screen.getByTestId('hidden').textContent).toBe('favorites')
  })

  it('ignores a saved preference that hides a pinned item', () => {
    renderStore({ hidden: ['settings'] })

    expect(screen.getByTestId('hidden').textContent).toBe('')
  })

  it('sends one full snapshot per change', async () => {
    renderStore()

    click('hide favorites')

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith({
      navOrder: [...DEFAULT_NAV_ORDER],
      navHidden: ['favorites']
    })
  })

  it('coalesces edits made while a save is in flight into one trailing write', async () => {
    let resolveFirst: (value: boolean) => void = () => {}
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = resolve
        })
    )

    renderStore()
    click('hide favorites')
    click('hide bookmarks')
    click('show favorites')

    // Only the first request has gone out so far.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveFirst(true)
    })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    // The trailing write carries the final state, not the intermediate ones.
    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ navHidden: ['bookmarks'] })
    )
  })

  it('sends an edit that undoes an in-flight change', async () => {
    let resolveFirst: (value: boolean) => void = () => {}
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = resolve
        })
    )

    renderStore()
    click('hide favorites')
    // Back to where it started — the account is mid-way to "favorites hidden",
    // so this has to be written even though it matches the last saved state.
    click('show favorites')

    await act(async () => {
      resolveFirst(true)
    })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ navHidden: [] })
    )
  })

  it('does not write while a drag is in progress, only on commit', async () => {
    renderStore()

    click('drag')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.getByTestId('order').textContent).toMatch(
      /^settings,timeline/
    )

    click('commit')
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
  })

  it('skips a save when nothing changed', async () => {
    renderStore()

    click('commit')

    await act(async () => {})
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })

  it('drops a failed save the user has since undone, instead of retrying it', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderStore()

    click('hide favorites')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )

    // Putting Favorites back means the account is right where it already is,
    // so there is nothing left to retry — and nothing left to warn about.
    click('show favorites')
    await waitFor(() =>
      expect(screen.getByTestId('state')).not.toHaveTextContent('error')
    )

    click('retry')
    await act(async () => {})
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('still saves an edit made after a failure that a later save recovered from', async () => {
    let resolveFirst: (value: boolean) => void = () => {}
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = resolve
        })
    )

    renderStore()
    click('hide favorites')
    click('hide bookmarks')
    await act(async () => {
      resolveFirst(false)
    })
    // The trailing save carries both hides and succeeds.
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))

    click('reset')

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(3))
    expect(mockUpdate).toHaveBeenLastCalledWith({ navOrder: [], navHidden: [] })
  })

  it('does not let a gesture that changed nothing undo a reset in flight', async () => {
    let resolveReset: (value: boolean) => void = () => {}
    renderStore({ order: ['settings', 'timeline'] })

    mockUpdate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReset = resolve
        })
    )
    click('reset')
    // A row picked up and dropped where it started, while the reset is still
    // in flight: it must not queue today's order over the reset's empty lists.
    click('commit')

    await act(async () => {
      resolveReset(true)
    })
    await act(async () => {})

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({ navOrder: [], navHidden: [] })
  })

  it('keeps a failed reset for retry when a later gesture changes nothing', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderStore({ order: ['settings', 'timeline'] })

    click('reset')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )

    // A drag dropped where it started leaves the navigation exactly as the
    // reset left it, so it must not stand in for the reset that still owes the
    // account its empty lists.
    click('commit')
    await act(async () => {})
    expect(mockUpdate).toHaveBeenCalledTimes(1)

    mockUpdate.mockResolvedValue(true)
    click('retry')

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate).toHaveBeenLastCalledWith({ navOrder: [], navHidden: [] })
  })

  it('keeps a reset queued behind an unrelated save that settles first', async () => {
    let resolveHide: (value: boolean) => void = () => {}
    renderStore({ order: ['settings', 'timeline'] })

    mockUpdate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHide = resolve
        })
    )
    click('hide favorites')
    // Queued behind the hide, so the hide landing must not be taken as the
    // account having settled what the reset is still owed.
    click('reset')

    await act(async () => {
      resolveHide(true)
    })
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate).toHaveBeenLastCalledWith({ navOrder: [], navHidden: [] })
  })

  it('still clears the stored lists when an edit made after a reset is undone', async () => {
    let resolveReset: (value: boolean) => void = () => {}
    renderStore({ order: ['settings', 'timeline'] })

    mockUpdate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReset = resolve
        })
    )
    click('reset')
    // An edit supersedes the reset, then the user takes it back. The navigation
    // is once again what reset produced, so the account should end up with the
    // empty lists reset asked for, not an explicit order.
    click('hide favorites')
    click('show favorites')

    await act(async () => {
      resolveReset(true)
    })
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate).toHaveBeenLastCalledWith({ navOrder: [], navHidden: [] })
  })

  it('still clears the stored lists when an edit made after a failed reset is undone', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderStore({ order: ['settings', 'timeline'] })

    click('reset')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )

    // An edit supersedes the failed reset and saves cleanly, which is the only
    // reason the failure stops being reported…
    click('hide favorites')
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))

    // …but the account never got the empty lists, so taking that edit back —
    // leaving the navigation exactly as reset left it — still owes them.
    click('show favorites')

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(3))
    expect(mockUpdate).toHaveBeenLastCalledWith({ navOrder: [], navHidden: [] })
  })

  it('drops a failed reset once the user has rebuilt what the account holds', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderStore({ hidden: ['favorites'] })

    click('reset')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )

    // Hiding Favorites again lands on exactly what the account already holds,
    // so there is nothing to send — and reset's empty lists can no longer
    // describe this navigation, so retrying them would store a sidebar the user
    // is not looking at.
    click('hide favorites')
    await waitFor(() =>
      expect(screen.getByTestId('state')).not.toHaveTextContent('error')
    )

    click('retry')
    await act(async () => {})
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('hidden').textContent).toBe('favorites')
  })

  it('retries a failed reset when the button is pressed again', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderStore({ order: ['settings', 'timeline'] })

    click('reset')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )

    // Pressing it again is what someone does when a control reports a failure,
    // so it has to mean the same as the footer's "Try again".
    click('reset')

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate).toHaveBeenLastCalledWith({ navOrder: [], navHidden: [] })
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('saved')
    )
  })

  it('clears the stored lists on reset even when the navigation already looks default', async () => {
    renderStore()

    // Hiding and un-hiding leaves the account storing an explicit order, which
    // Reset exists to clear — even though nothing on screen changes.
    click('hide favorites')
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    click('show favorites')
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))

    click('reset')

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenLastCalledWith({
        navOrder: [],
        navHidden: []
      })
    )
  })

  it('stores empty lists on reset so the account follows the shipped defaults', async () => {
    renderStore({ order: ['settings'], hidden: ['favorites'] })

    click('reset')

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ navOrder: [], navHidden: [] })
    )
    expect(screen.getByTestId('order').textContent).toBe(
      [...DEFAULT_NAV_ORDER].join(',')
    )
    expect(screen.getByTestId('hidden').textContent).toBe('')
  })

  it('reports a failed save and keeps the change on screen', async () => {
    mockUpdate.mockResolvedValueOnce(false)
    renderStore()

    click('hide favorites')

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )
    expect(screen.getByTestId('hidden').textContent).toBe('favorites')
  })

  it('reports a rejected save as an error rather than throwing', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('offline'))
    renderStore()

    click('hide favorites')

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error')
    )
  })
})

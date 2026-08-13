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

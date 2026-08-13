'use client'

import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react'

import { updateNavigationPreferences } from '@/lib/client'
import {
  type NavItemId,
  isNavItemLocked,
  moveNavItem,
  moveNavItemTo,
  normalizedHidden,
  normalizedOrder
} from '@/lib/services/navigation/navPreferences'

export type NavSaveState = 'idle' | 'saving' | 'saved' | 'error'

interface NavPreferencesState {
  order: NavItemId[]
  hidden: NavItemId[]
}

export interface NavPreferencesStore extends NavPreferencesState {
  hideItem: (id: NavItemId) => void
  showItem: (id: NavItemId) => void
  // Swaps with the nearest visible neighbour. `visible` is the surface's own
  // idea of what is on screen, so hidden and unavailable items keep their slot.
  move: (
    id: NavItemId,
    direction: -1 | 1,
    visible: ReadonlySet<NavItemId>
  ) => void
  // Local-only reorder used while a drag is in flight; call `commit` on drop so
  // a whole drag costs one write instead of one per row it crosses.
  moveTo: (dragId: NavItemId, overId: NavItemId) => void
  // Puts the order back where it was, without saving — for a drag the user
  // abandoned after it had already moved rows on screen.
  restoreOrder: (order: NavItemId[]) => void
  commit: () => void
  reset: () => void
  saveState: NavSaveState
  retry: () => void
}

const defaultStore: NavPreferencesStore = {
  order: normalizedOrder({}),
  hidden: [],
  hideItem: () => {},
  showItem: () => {},
  move: () => {},
  moveTo: () => {},
  restoreOrder: () => {},
  commit: () => {},
  reset: () => {},
  saveState: 'idle',
  retry: () => {}
}

// Defaults keep an unwrapped consumer (a test rendering the sidebar on its own,
// or the logged-out tree) rendering the shipped navigation rather than throwing.
const NavPreferencesContext = createContext<NavPreferencesStore>(defaultStore)

interface NavPreferencesProviderProps {
  initialOrder?: string[]
  initialHidden?: string[]
  children: ReactNode
}

const snapshotKey = ({
  order,
  hidden
}: {
  order: readonly string[]
  hidden: readonly string[]
}) => JSON.stringify([order, hidden])

interface ApplyOptions {
  persist?: boolean
  // What goes over the wire, when that differs from what the navigation now
  // looks like: Reset stores empty lists so the account keeps following the
  // shipped navigation as it changes in later releases. Passing this marks the
  // save as deliberate, so it is sent even when the navigation looks unchanged.
  payload?: NavPreferencesState
}

interface PendingSave {
  // The lists to send…
  payload: NavPreferencesState
  // …and the navigation they leave behind, which is what tells a later edit
  // whether anything the user can see has actually changed.
  state: NavPreferencesState
  // Set for a save whose point is invisible in the navigation (Reset clears the
  // stored lists), so an edit that changes nothing on screen cannot quietly
  // replace or discard it.
  deliberate: boolean
}

/**
 * Holds the navigation customization for the whole signed-in tree.
 *
 * It is one store rather than per-surface state because the sidebar and the
 * Settings → Navigation manager are on screen together on wide viewports, and a
 * soft navigation never re-renders the layout that seeded them — without shared
 * state the sidebar would keep rendering the layout the user just changed.
 *
 * State is seeded from server props (no localStorage, no clock, no random), so
 * the server and client render identically on hydration.
 */
export const NavPreferencesProvider: FC<NavPreferencesProviderProps> = ({
  initialOrder,
  initialHidden,
  children
}) => {
  const [state, setState] = useState<NavPreferencesState>(() => ({
    order: normalizedOrder({ navOrder: initialOrder }),
    hidden: normalizedHidden({
      navOrder: initialOrder,
      navHidden: initialHidden
    })
  }))
  const [saveState, setSaveState] = useState<NavSaveState>('idle')

  // A drag fires `moveTo` many times per tick, so mutators read and write this
  // ref rather than the state they were rendered with.
  const stateRef = useRef(state)

  // Everything below is keyed on the *payload* — what actually goes over the
  // wire — rather than on what the navigation looks like. The two differ (Reset
  // stores empty lists while showing today's defaults), and keying on the
  // visible state made Reset look like a no-op whenever the visible order
  // already matched the defaults.
  //
  // `pendingRef` is the save still owed to the account, or null when the
  // account is up to date. A newer edit overwrites it, so it always holds the
  // latest intent, and a failed save leaves it in place for `retry`.
  const pendingRef = useRef<PendingSave | null>(null)
  // What the account is known to hold: the lists it was seeded from, verbatim,
  // and the navigation they produce.
  const savedPayloadKeyRef = useRef(
    snapshotKey({ order: initialOrder ?? [], hidden: initialHidden ?? [] })
  )
  const savedStateKeyRef = useRef(snapshotKey(state))
  // A deliberate save the account has not accepted yet. Reset's whole point is
  // invisible in the navigation, so an edit that supersedes it and is then
  // undone would otherwise leave the user looking at the reset navigation while
  // the account keeps the explicit lists reset was meant to clear. Remembering
  // it means any later save that lands on the same navigation carries it.
  const owedDeliberateRef = useRef<PendingSave | null>(null)
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)

  const flush = useCallback(async () => {
    if (savingRef.current) {
      dirtyRef.current = true
      return
    }
    const pending = pendingRef.current
    if (!pending) return

    savingRef.current = true
    dirtyRef.current = false
    setSaveState('saving')
    let saved: boolean
    try {
      saved = await updateNavigationPreferences({
        navOrder: pending.payload.order,
        navHidden: pending.payload.hidden
      })
    } catch {
      saved = false
    }
    savingRef.current = false
    setSaveState(saved ? 'saved' : 'error')
    if (saved) {
      savedPayloadKeyRef.current = snapshotKey(pending.payload)
      savedStateKeyRef.current = snapshotKey(pending.state)
      // Clear the debt unless a newer edit queued itself while this was in
      // flight, in which case the trailing save below owns it.
      if (pendingRef.current === pending) pendingRef.current = null
      // Any accepted save settles the account, so a Reset that an edit
      // superseded is no longer owed — the user's later edits are the intent
      // now. Only a Reset that never landed is worth reviving.
      owedDeliberateRef.current = null
    }
    // A failed payload stays queued so `retry` — and any later save — carries
    // it, unless the user has since edited, which replaces it outright.

    // Edits that landed mid-flight are persisted by one trailing save. Every
    // request carries the whole state, so only the final payload matters.
    if (dirtyRef.current && pendingRef.current) void flush()
  }, [])

  // Applies a new state, and persists it unless this is a local step of a drag
  // (the drop commits once) or the account already holds what this would send.
  const apply = useCallback(
    (
      next: NavPreferencesState,
      { persist = true, payload }: ApplyOptions = {}
    ) => {
      stateRef.current = next
      setState(next)
      if (!persist) return

      const nextStateKey = snapshotKey(next)
      // An ordinary edit that lands back on the navigation a not-yet-accepted
      // Reset produced carries that Reset's lists instead of today's order, so
      // undoing an edit made after a Reset does not quietly cancel it.
      const owedDeliberate = owedDeliberateRef.current
      const revivesDeliberate =
        !payload &&
        owedDeliberate !== null &&
        nextStateKey === snapshotKey(owedDeliberate.state)
      const nextPayload = revivesDeliberate
        ? owedDeliberate.payload
        : (payload ?? next)
      const nextPayloadKey = snapshotKey(nextPayload)
      const queued = pendingRef.current

      // Already queued, verbatim.
      if (queued && nextPayloadKey === snapshotKey(queued.payload)) return

      // An ordinary edit only has something to say when the navigation actually
      // changed. (A deliberate save skips this: Reset clears the stored lists,
      // which the navigation never shows.)
      if (!payload && !revivesDeliberate) {
        // Unchanged since the save already queued — a drag dropped where it
        // started, or an edit undone while its save was in flight. Leave that
        // save alone rather than overwriting it: replacing a queued Reset with
        // today's order would quietly undo it.
        const referenceStateKey = queued
          ? snapshotKey(queued.state)
          : savedStateKeyRef.current
        if (nextStateKey === referenceStateKey) return

        // Back to what the account already holds, and nothing is in flight to
        // land after this: drop the queued save the user has undone, along with
        // any failure it was reporting. A deliberate one stays for `retry`.
        if (!savingRef.current && nextStateKey === savedStateKeyRef.current) {
          if (queued?.deliberate) return
          pendingRef.current = null
          if (queued) setSaveState('saved')
          return
        }
      }

      // The account already holds exactly these lists, so there is nothing to
      // send — unless a save is in flight, whose result this has to land after.
      if (!savingRef.current && nextPayloadKey === savedPayloadKeyRef.current) {
        if (queued?.deliberate) return
        pendingRef.current = null
        if (queued) setSaveState('saved')
        return
      }

      const save: PendingSave = {
        payload: nextPayload,
        state: next,
        deliberate: Boolean(payload) || revivesDeliberate
      }
      if (save.deliberate) owedDeliberateRef.current = save
      pendingRef.current = save
      void flush()
    },
    [flush]
  )

  const hideItem = useCallback(
    (id: NavItemId) => {
      const { order, hidden } = stateRef.current
      if (isNavItemLocked(id) || hidden.includes(id)) return
      apply({
        order,
        // Keep "More" in sidebar order rather than click order.
        hidden: order.filter((item) => item === id || hidden.includes(item))
      })
    },
    [apply]
  )

  const showItem = useCallback(
    (id: NavItemId) => {
      const { order, hidden } = stateRef.current
      if (!hidden.includes(id)) return
      apply({ order, hidden: hidden.filter((item) => item !== id) })
    },
    [apply]
  )

  const move = useCallback(
    (id: NavItemId, direction: -1 | 1, visible: ReadonlySet<NavItemId>) => {
      const { order, hidden } = stateRef.current
      const nextOrder = moveNavItem(order, visible, id, direction)
      apply({
        order: nextOrder,
        hidden: nextOrder.filter((item) => hidden.includes(item))
      })
    },
    [apply]
  )

  const moveTo = useCallback(
    (dragId: NavItemId, overId: NavItemId) => {
      const { order, hidden } = stateRef.current
      const nextOrder = moveNavItemTo(order, dragId, overId)
      apply(
        {
          order: nextOrder,
          hidden: nextOrder.filter((item) => hidden.includes(item))
        },
        { persist: false }
      )
    },
    [apply]
  )

  const restoreOrder = useCallback(
    (order: NavItemId[]) => {
      const { hidden } = stateRef.current
      apply(
        { order, hidden: order.filter((item) => hidden.includes(item)) },
        { persist: false }
      )
    },
    [apply]
  )

  const commit = useCallback(() => {
    apply(stateRef.current)
  }, [apply])

  const reset = useCallback(() => {
    apply(
      { order: normalizedOrder({}), hidden: [] },
      { payload: { order: [], hidden: [] } }
    )
  }, [apply])

  const retry = useCallback(() => {
    if (!pendingRef.current) return
    void flush()
  }, [flush])

  const store = useMemo<NavPreferencesStore>(
    () => ({
      order: state.order,
      hidden: state.hidden,
      hideItem,
      showItem,
      move,
      moveTo,
      restoreOrder,
      commit,
      reset,
      saveState,
      retry
    }),
    [
      commit,
      hideItem,
      move,
      moveTo,
      restoreOrder,
      reset,
      retry,
      saveState,
      showItem,
      state.hidden,
      state.order
    ]
  )

  return (
    <NavPreferencesContext.Provider value={store}>
      {children}
    </NavPreferencesContext.Provider>
  )
}

export const useNavPreferences = (): NavPreferencesStore =>
  useContext(NavPreferencesContext)

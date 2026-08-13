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

const snapshotKey = ({ order, hidden }: NavPreferencesState) =>
  JSON.stringify([order, hidden])

interface PendingSave {
  // What the navigation looks like once this save lands…
  state: NavPreferencesState
  // …and what actually goes over the wire (Reset stores empty lists so the
  // account follows the shipped navigation as it changes in later releases).
  payload: NavPreferencesState
}

interface ApplyOptions {
  persist?: boolean
  payload?: NavPreferencesState
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
  // The snapshot to persist next, the last one the server accepted, whether a
  // request is in flight, and whether another save became due while it ran.
  const pendingRef = useRef<PendingSave | null>(null)
  const seededKey = snapshotKey({
    order: normalizedOrder({ navOrder: initialOrder }),
    hidden: normalizedHidden({
      navOrder: initialOrder,
      navHidden: initialHidden
    })
  })
  const savedKeyRef = useRef(seededKey)
  // What the account will hold once everything in flight has drained. Edits are
  // compared against this rather than the last *saved* state: undoing an edit
  // while its save is still running has to be sent, or the server keeps the
  // value the user just took back.
  const targetKeyRef = useRef(seededKey)
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)

  const flush = useCallback(async () => {
    if (savingRef.current) {
      dirtyRef.current = true
      return
    }
    const snapshot = pendingRef.current
    if (!snapshot) return

    savingRef.current = true
    dirtyRef.current = false
    setSaveState('saving')
    let saved: boolean
    try {
      saved = await updateNavigationPreferences({
        navOrder: snapshot.payload.order,
        navHidden: snapshot.payload.hidden
      })
    } catch {
      saved = false
    }
    savingRef.current = false
    setSaveState(saved ? 'saved' : 'error')
    if (saved) {
      savedKeyRef.current = snapshotKey(snapshot.state)
    } else {
      // Nothing reached the account, so let the next edit resend even if it
      // lands back on the snapshot that just failed.
      targetKeyRef.current = savedKeyRef.current
    }

    // Edits that landed mid-flight are persisted by one trailing save. Every
    // request carries the whole state, so only the final snapshot matters.
    if (dirtyRef.current && pendingRef.current) void flush()
  }, [])

  // Applies a new state, and persists it unless this is a local step of a drag
  // (the drop commits once) or nothing actually changed. `payload` lets Reset
  // store empty lists while the UI shows today's defaults.
  const apply = useCallback(
    (
      next: NavPreferencesState,
      { persist = true, payload }: ApplyOptions = {}
    ) => {
      stateRef.current = next
      setState(next)
      if (!persist) return
      const key = snapshotKey(next)
      if (key === targetKeyRef.current) return
      targetKeyRef.current = key
      pendingRef.current = { state: next, payload: payload ?? next }
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

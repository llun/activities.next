'use client'

import { useSyncExternalStore } from 'react'

import { getBlueskyAccount } from '@/lib/client/blueskyAccount'
import type { BlueskyLinkedAccount } from '@/lib/utils/blueskyAccount'

// The viewer's linked Bluesky account (did + handle), fetched once per page
// load when a Bluesky reply composer or Bluesky post menu needs it, and shared
// across every composer and menu on the page. Keyed by actorId so a profile
// switch never leaks the previous actor's linked Bluesky identity.

interface StoreState {
  actorId: string | null
  account: BlueskyLinkedAccount | null
  status: 'idle' | 'loading' | 'loaded' | 'error'
}

const INITIAL_STATE: StoreState = {
  actorId: null,
  account: null,
  status: 'idle'
}

let state: StoreState = INITIAL_STATE
let latestLoad = 0
const listeners = new Set<() => void>()

const emit = (next: StoreState) => {
  state = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const switchToActor = (actorId: string) => {
  if (state.actorId === actorId) return
  emit({ actorId, account: null, status: 'idle' })
}

/**
 * Loads the actor's linked Bluesky account unless it is already loaded or
 * loading; a failure retries on the next call. Never throws.
 */
export const loadLinkedBlueskyAccount = async (
  actorId: string
): Promise<void> => {
  switchToActor(actorId)
  if (state.status === 'loading' || state.status === 'loaded') return
  latestLoad += 1
  const token = latestLoad
  emit({ ...state, status: 'loading' })
  try {
    const result = await getBlueskyAccount()
    if (token !== latestLoad || state.actorId !== actorId) return
    emit({
      actorId,
      account: result?.account ?? null,
      status: result ? 'loaded' : 'error'
    })
  } catch {
    if (token !== latestLoad || state.actorId !== actorId) return
    emit({ actorId, account: null, status: 'error' })
  }
}

/** Sets the actor's linked Bluesky account directly (for tests). */
export const setLinkedBlueskyAccount = (
  actorId: string,
  account: BlueskyLinkedAccount | null
) => {
  latestLoad += 1
  emit({ actorId, account, status: 'loaded' })
}

/** The actor's linked Bluesky account, or null until loaded or for another actor. */
export const useLinkedBlueskyAccount = (
  actorId: string | undefined
): BlueskyLinkedAccount | null => {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL_STATE
  )
  return actorId && snapshot.actorId === actorId ? snapshot.account : null
}

/** Resets the store between tests. */
export const resetBlueskyAccountStore = () => {
  latestLoad += 1
  emit(INITIAL_STATE)
}

'use client'

import { useSyncExternalStore } from 'react'

import { getBookmarkFolders } from '@/lib/client'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'

// The viewer's bookmark folders, fetched once per page load the first time a
// post's ⋯ menu (or the Bookmarks page) needs them, and shared by every menu
// on the page, so opening twenty menus is still one request. The Bookmarks
// page seeds it from the server and every folder write updates it, so a menu
// never offers a folder that was just deleted.
//
// It holds ONE actor's folders, named by every call: a profile switch in
// another tab changes the session under this one, and the next page's
// `currentActor` is then someone else, whose menus must never show the first
// actor's private folder names. Asking for another actor empties it.

export interface BookmarkFolderState {
  folders: BookmarkFolderEntity[]
  status: 'idle' | 'loading' | 'loaded' | 'error'
}

interface StoreState extends BookmarkFolderState {
  actorId: string | null
}

const EMPTY_STATE: BookmarkFolderState = { folders: [], status: 'idle' }
const INITIAL_STATE: StoreState = { actorId: null, ...EMPTY_STATE }
let state = INITIAL_STATE
// Bumped by every write and actor switch: a load that started before one
// must not overwrite what it wrote.
let generation = 0
// Bumped by every load and refresh: only the newest one may read again or
// report a failure, so two overtaken loads never keep restarting each other.
let latestLoad = 0
const listeners = new Set<() => void>()

// Read through this after an await: `state` may have changed meanwhile, which
// a narrowed `state.status` would not show.
const current = (): StoreState => state

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

/** By name, case-insensitively, as the server lists them. */
const sortFolders = (folders: BookmarkFolderEntity[]) =>
  [...folders].sort((a, b) => {
    const left = a.name.toLowerCase()
    const right = b.name.toLowerCase()
    if (left !== right) return left < right ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

// Points the store at `actorId`, dropping another actor's folders.
const switchToActor = (actorId: string) => {
  if (state.actorId === actorId) return
  generation += 1
  emit({ actorId, ...EMPTY_STATE })
}

/**
 * Loads the actor's folders unless they are loaded or loading; a failure
 * retries on the next call. A load that a write overtook is thrown away and
 * made again, so it cannot drop a new folder or bring back a deleted one.
 */
export const loadBookmarkFolders = async (actorId: string): Promise<void> => {
  switchToActor(actorId)
  if (state.status === 'loading' || state.status === 'loaded') return
  generation += 1
  const started = generation
  latestLoad += 1
  const token = latestLoad
  emit({ ...state, status: 'loading' })
  try {
    const folders = await getBookmarkFolders()
    if (generation === started) {
      emit({ actorId, folders: sortFolders(folders), status: 'loaded' })
      return
    }
    // Overtaken. A newer load (after an actor switch and back) owns the
    // store now; a write that made the list whole (the page's seed) has
    // already marked it loaded; otherwise read it again.
    const now = current()
    if (
      token === latestLoad &&
      now.actorId === actorId &&
      now.status === 'loading'
    ) {
      emit({ ...now, status: 'idle' })
      await loadBookmarkFolders(actorId)
    }
  } catch {
    const now = current()
    if (
      token === latestLoad &&
      now.actorId === actorId &&
      now.status === 'loading'
    ) {
      emit({ ...now, status: 'error' })
    }
  }
}

/**
 * Re-reads a list that is already loaded, keeping it on screen meanwhile; a
 * write or another load that lands first wins. Loads it when it is not.
 */
export const refreshBookmarkFolders = async (
  actorId: string
): Promise<void> => {
  if (state.actorId !== actorId || state.status !== 'loaded') {
    return loadBookmarkFolders(actorId)
  }
  const started = generation
  latestLoad += 1
  const token = latestLoad
  try {
    const folders = await getBookmarkFolders()
    if (
      token === latestLoad &&
      generation === started &&
      current().actorId === actorId
    ) {
      generation += 1
      emit({ actorId, folders: sortFolders(folders), status: 'loaded' })
    }
  } catch {
    // The list on screen stays; the next refresh tries again.
  }
}

/**
 * The Bookmarks page's server list. A store already loaded for the actor
 * (a router-cache back navigation hands the page its old list) may hold
 * newer writes, so it is kept and refreshed instead of overwritten.
 */
export const seedBookmarkFolders = (
  actorId: string,
  folders: BookmarkFolderEntity[]
) => {
  if (state.actorId === actorId && state.status === 'loaded') {
    void refreshBookmarkFolders(actorId)
    return
  }
  setBookmarkFolders(actorId, folders)
}

/** The whole list, from the server: the store is loaded. */
export const setBookmarkFolders = (
  actorId: string,
  folders: BookmarkFolderEntity[]
) => {
  switchToActor(actorId)
  generation += 1
  emit({ actorId, folders: sortFolders(folders), status: 'loaded' })
}

// One write to a list that may not be whole: the status stays as it was, so
// a store that has not loaded (or failed to) still loads the rest next time.
const writeFolders = (actorId: string, folders: BookmarkFolderEntity[]) => {
  switchToActor(actorId)
  generation += 1
  emit({ ...state, folders: sortFolders(folders) })
}

/** Adds or replaces one folder (a create or a rename). */
export const putBookmarkFolder = (
  actorId: string,
  folder: BookmarkFolderEntity
) => {
  switchToActor(actorId)
  writeFolders(actorId, [
    ...state.folders.filter((item) => item.id !== folder.id),
    folder
  ])
}

export const removeBookmarkFolder = (actorId: string, id: string) => {
  switchToActor(actorId)
  writeFolders(
    actorId,
    state.folders.filter((item) => item.id !== id)
  )
}

/** The actor's folders; nothing, until loaded, for any other actor. */
export const useBookmarkFolders = (
  actorId: string | undefined
): BookmarkFolderState => {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL_STATE
  )
  return actorId && snapshot.actorId === actorId ? snapshot : EMPTY_STATE
}

/** Tests start from an empty, unloaded store. */
export const resetBookmarkFolderStore = () => {
  generation += 1
  emit(INITIAL_STATE)
}

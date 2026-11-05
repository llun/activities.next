'use client'

import { useSyncExternalStore } from 'react'

import { getBookmarkFolders } from '@/lib/client'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'

// The viewer's bookmark folders, fetched once per page load the first time a
// post's ⋯ menu (or the Bookmarks page) needs them, and shared by every menu
// on the page, so opening twenty menus is still one request. The Bookmarks
// page seeds it from the server and every folder write updates it, so a menu
// never offers a folder that was just deleted.

export interface BookmarkFolderState {
  folders: BookmarkFolderEntity[]
  status: 'idle' | 'loading' | 'loaded' | 'error'
}

const INITIAL_STATE: BookmarkFolderState = { folders: [], status: 'idle' }
let state = INITIAL_STATE
const listeners = new Set<() => void>()

const emit = (next: BookmarkFolderState) => {
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

/** Loads the folders unless they are loaded or loading; a failure retries on the next call. */
export const loadBookmarkFolders = async (): Promise<void> => {
  if (state.status === 'loading' || state.status === 'loaded') return
  emit({ ...state, status: 'loading' })
  try {
    emit({ folders: sortFolders(await getBookmarkFolders()), status: 'loaded' })
  } catch {
    emit({ ...state, status: 'error' })
  }
}

export const setBookmarkFolders = (folders: BookmarkFolderEntity[]) =>
  emit({ folders: sortFolders(folders), status: 'loaded' })

/** Adds or replaces one folder (a create or a rename). */
export const putBookmarkFolder = (folder: BookmarkFolderEntity) =>
  setBookmarkFolders([
    ...state.folders.filter((item) => item.id !== folder.id),
    folder
  ])

export const removeBookmarkFolder = (id: string) =>
  setBookmarkFolders(state.folders.filter((item) => item.id !== id))

export const useBookmarkFolders = (): BookmarkFolderState =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL_STATE
  )

/** Tests start from an empty, unloaded store. */
export const resetBookmarkFolderStore = () => emit(INITIAL_STATE)

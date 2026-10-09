'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  addGalleryAlbumItems,
  getMediaAlbums,
  removeGalleryAlbumItems
} from '@/lib/client'
import {
  NOT_ADDABLE_HINT,
  albumAddedMessage,
  albumRemovedMessage
} from '@/lib/components/gallery/mediaAlbumsUi'
import type { MediaAlbumOptionEntity } from '@/lib/services/gallery/galleryAlbumEntities'

// How long the "Added to …" message waits for an Undo.
export const ALBUM_TOAST_DURATION_MS = 8000

export type MediaAlbumsStatus =
  | 'loading'
  | 'ready'
  // Not the caller's photo (the route's 404): there is no menu to show.
  | 'hidden'
  | 'error'

export interface AlbumToast {
  /** Changes with every message, so the same text twice is two toasts. */
  id: number
  message: string
  /** Undoes the change; absent on a message that has nothing to undo. */
  undo: (() => void) | null
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

/**
 * Album membership of one photo for its owner, with immediate writes. Nothing
 * here belongs to a form: a toggle is saved as soon as it is made (and put
 * back when the save fails), so the host dialog's own Save never sees it.
 */
export const useMediaAlbums = (
  mediaId: string,
  /** Called with the album's id after a write that changed its photos. */
  onChange?: (albumId: string) => void
) => {
  const [status, setStatus] = useState<MediaAlbumsStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [albums, setAlbums] = useState<MediaAlbumOptionEntity[]>([])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [addable, setAddable] = useState(true)
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [writeError, setWriteError] = useState<string | null>(null)
  const [toast, setToast] = useState<AlbumToast | null>(null)
  // Spoken by a live region that is always on the page; the visible toast is
  // not itself a live region, so a message is read once.
  const [announcement, setAnnouncement] = useState('')
  const toastId = useRef(0)
  // Bumped for every photo and every reload, so a slow answer for an earlier
  // one is dropped.
  const generation = useRef(0)
  // The ids being written right now, readable between renders.
  const busyRef = useRef(new Set<string>())
  const mounted = useRef(true)
  const stateRef = useRef({ albums, memberIds, addable, status })
  stateRef.current = { albums, memberIds, addable, status }
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // `quiet` reads the data again without leaving `ready`: the menu, its
  // message and the focus inside it stay where they are while the answer
  // comes. A failed quiet read keeps what was shown.
  const load = useCallback(
    async (quiet = false) => {
      const current = ++generation.current
      if (!quiet) {
        setStatus('loading')
        setLoadError(null)
      }
      try {
        const response = await getMediaAlbums(mediaId)
        if (current !== generation.current || !mounted.current) return
        if (!response) {
          setStatus('hidden')
          return
        }
        setAlbums(response.albums)
        setMemberIds(response.albumIds)
        setAddable(response.addable)
        setStatus('ready')
      } catch (error) {
        if (current !== generation.current || !mounted.current) return
        if (quiet) return
        setLoadError(errorText(error, 'Failed to load albums.'))
        setStatus('error')
      }
    },
    [mediaId]
  )

  // Reading again after a change made elsewhere (a new album holding the
  // photo) is quiet once there is something on screen to keep.
  const reload = useCallback(
    () => load(stateRef.current.status === 'ready'),
    [load]
  )

  useEffect(() => {
    setAlbums([])
    setMemberIds([])
    setBusyIds([])
    busyRef.current = new Set()
    setWriteError(null)
    setToast(null)
    setAnnouncement('')
    void load()
    return () => {
      // A later photo (or unmount) makes this one's answers stale.
      generation.current += 1
    }
  }, [load])

  const say = useCallback((message: string, undo: (() => void) | null) => {
    toastId.current += 1
    setToast({ id: toastId.current, message, undo })
    setAnnouncement(message)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  const markBusy = (albumId: string, busy: boolean) => {
    if (busy) busyRef.current.add(albumId)
    else busyRef.current.delete(albumId)
    if (mounted.current) setBusyIds([...busyRef.current])
  }

  const setCount = (albumId: string, itemCount: number) =>
    setAlbums((current) =>
      current.map((album) =>
        album.id === albumId ? { ...album, itemCount } : album
      )
    )

  /**
   * Puts the photo in (`wanted`) or takes it out of an album. The change shows
   * at once and is put back if the write fails. A write that works offers an
   * Undo, which is itself a write and offers nothing further.
   */
  const setMembership = useCallback(
    async (albumId: string, wanted: boolean, offerUndo = true) => {
      if (busyRef.current.has(albumId)) return
      const {
        albums: knownAlbums,
        memberIds: knownMembers,
        addable: canAdd
      } = stateRef.current
      const album = knownAlbums.find((candidate) => candidate.id === albumId)
      if (!album || knownMembers.includes(albumId) === wanted) return

      const previousCount = album.itemCount
      const generationAtStart = generation.current
      markBusy(albumId, true)
      setWriteError(null)
      setMemberIds((current) =>
        wanted ? [...current, albumId] : current.filter((id) => id !== albumId)
      )
      setCount(albumId, Math.max(previousCount + (wanted ? 1 : -1), 0))

      try {
        if (wanted) {
          const result = await addGalleryAlbumItems(albumId, [mediaId])
          // Only the owner's posted gallery photos are added; anything else is
          // reported back as skipped rather than failing the request.
          if (result.skipped.includes(mediaId)) {
            throw new Error(NOT_ADDABLE_HINT)
          }
          if (generationAtStart === generation.current && mounted.current) {
            setCount(albumId, result.album.itemCount)
          }
        } else {
          const result = await removeGalleryAlbumItems(albumId, [mediaId])
          if (generationAtStart === generation.current && mounted.current) {
            setCount(albumId, result.album.itemCount)
          }
        }
        if (generationAtStart !== generation.current || !mounted.current) return
        // Undoing a removal is an add, which a photo that can no longer be
        // added (its post was deleted, say) would only refuse.
        const canUndo = offerUndo && (wanted || canAdd)
        say(
          wanted
            ? albumAddedMessage(album.title)
            : albumRemovedMessage(album.title),
          canUndo ? () => void setMembership(albumId, !wanted, false) : null
        )
        onChangeRef.current?.(albumId)
      } catch (error) {
        if (generationAtStart !== generation.current || !mounted.current) return
        setMemberIds((current) =>
          wanted
            ? current.filter((id) => id !== albumId)
            : current.includes(albumId)
              ? current
              : [...current, albumId]
        )
        setCount(albumId, previousCount)
        const message = `Couldn’t ${wanted ? 'add to' : 'remove from'} “${album.title}”. ${errorText(error, 'Try again.')}`
        // The alert that shows the message speaks it; the always-on live
        // region would say it a second time.
        setWriteError(message)
        setToast(null)
        setAnnouncement('')
      } finally {
        markBusy(albumId, false)
      }
    },
    // `mediaId` is the only input; the rest is read through refs.
    [mediaId, say]
  )

  const toggle = useCallback(
    (albumId: string) => {
      const isMember = stateRef.current.memberIds.includes(albumId)
      void setMembership(albumId, !isMember)
    },
    [setMembership]
  )

  return {
    status,
    loadError,
    albums,
    memberIds,
    addable,
    busyIds,
    writeError,
    toast,
    announcement,
    toggle,
    dismissToast,
    reload
  }
}

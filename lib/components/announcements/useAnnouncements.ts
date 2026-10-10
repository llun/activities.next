'use client'

import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  addAnnouncementReaction,
  dismissAnnouncement,
  getAnnouncements,
  removeAnnouncementReaction
} from '@/lib/client'
import type {
  Announcement,
  AnnouncementReaction
} from '@/lib/types/mastodon/announcement'

/**
 * Owns the home timeline's announcement state once: the fetched list, the
 * pager, whether the panel is open, the mark-read-on-view timer and the
 * reactions. The page header renders its actions in more than one place (the
 * desktop box and the mobile bar), and every copy is presentational over this
 * one state, so there is one fetch, one timer and one open state however many
 * copies mount.
 *
 * Nothing is persisted, and the panel never opens by itself: it opens only
 * from the header icon (which also toggles it closed).
 */
export interface AnnouncementsState {
  announcements: Announcement[]
  current: Announcement | undefined
  index: number
  setIndex: (updater: (value: number) => number) => void
  unreadCount: number
  /** Whether there is at least one active announcement, read or unread. */
  hasAnnouncements: boolean
  open: boolean
  /** Opens the panel (the triggers close through `closeAndRefocus`). */
  openPanel: () => void
  /** Closes without touching focus (outside press, focus moving away). */
  close: () => void
  /**
   * Closes and returns focus to the trigger. Every mounted copy tries; the
   * hidden copy's `focus()` does nothing.
   */
  closeAndRefocus: () => void
  /** Set by `closeAndRefocus`; a trigger clears it once it holds focus. */
  focusRequest: MutableRefObject<boolean>
  onAdd: (name: string) => Promise<void>
  onToggleReaction: (name: string) => Promise<void>
}

export const useAnnouncements = (): AnnouncementsState => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [index, setIndexState] = useState(0)
  const [open, setOpenState] = useState(false)
  // Ids whose mark-read timer already fired, so each announcement dismisses at
  // most once even as the pager moves back and forth.
  const dismissed = useRef<Set<string>>(new Set())
  // Ids whose dismiss failed during this open. They are not retried until the
  // panel is opened again, so a failing endpoint is not hammered every 900ms.
  const failed = useRef<Set<string>>(new Set())
  const focusRequest = useRef(false)

  // Load the active announcements (read and unread) once on mount; the panel
  // pages across all of them.
  useEffect(() => {
    let active = true
    getAnnouncements()
      .then((loaded) => {
        if (!active) return
        setAnnouncements(loaded)
        // Newest first: the panel opens on the first unread item, so the one
        // the reader sees first is the one that gets marked read.
        const firstUnread = loaded.findIndex(
          (announcement) => announcement.read === false
        )
        if (firstUnread > 0) setIndexState(firstUnread)
      })
      .catch(() => {
        // A failure to load announcements degrades to showing none rather than
        // surfacing an error on the timeline.
      })
    return () => {
      active = false
    }
  }, [])

  const unreadCount = useMemo(
    () =>
      announcements.filter((announcement) => announcement.read === false)
        .length,
    [announcements]
  )
  const safeIndex = Math.min(index, Math.max(announcements.length - 1, 0))
  const current = announcements[safeIndex]

  const setIndex = useCallback(
    (updater: (value: number) => number) => setIndexState(updater),
    []
  )

  // Mark-read-on-view: an unread announcement shown in the open panel for
  // ~900ms fires POST dismiss and flips to read locally. "Dismiss" means mark
  // READ, not remove: the item stays in the pager and the "{n} new" count
  // drains live. Fired once per id.
  useEffect(() => {
    if (!open || !current || current.read !== false) return
    if (dismissed.current.has(current.id) || failed.current.has(current.id)) {
      return
    }
    const id = current.id
    const setRead = (read: boolean) =>
      setAnnouncements((previous) =>
        previous.map((announcement) =>
          announcement.id === id ? { ...announcement, read } : announcement
        )
      )
    const timer = setTimeout(() => {
      dismissed.current.add(id)
      setRead(true)
      // Swallow a network-layer rejection so the timer never produces an
      // unhandled rejection. On failure revert the optimistic flip and clear
      // the marker; a later open retries once.
      const revert = () => {
        dismissed.current.delete(id)
        failed.current.add(id)
        setRead(false)
      }
      void dismissAnnouncement(id)
        .then((ok) => {
          if (!ok) revert()
        })
        .catch(revert)
    }, 900)
    return () => clearTimeout(timer)
  }, [current, open])

  const close = useCallback(() => setOpenState(false), [])

  // Closes and asks the trigger to take focus back (Escape, or the trigger
  // itself): "return focus to the control that opened the panel".
  const closeAndRefocus = useCallback(() => {
    focusRequest.current = true
    close()
  }, [close])

  const openPanel = useCallback(() => {
    // A failed mark-read is retried once per open.
    failed.current.clear()
    // Opening from the unread dot should show something new: when the item the
    // pager rests on is already read and another is unread, jump to the first
    // unread one. Otherwise the pager stays where the reader left it.
    setIndexState((value) => {
      const at = Math.min(value, Math.max(announcements.length - 1, 0))
      if (announcements[at]?.read !== true) return value
      const firstUnread = announcements.findIndex(
        (announcement) => announcement.read === false
      )
      return firstUnread >= 0 ? firstUnread : value
    })
    setOpenState(true)
  }, [announcements])

  // Runs after the triggers' own effects (children first), so a request made
  // by a close has had its chance to be taken by the mounted trigger.
  useEffect(() => {
    if (!open) focusRequest.current = false
  }, [open])

  const mutateReactions = useCallback(
    (
      transform: (reactions: AnnouncementReaction[]) => AnnouncementReaction[]
    ) => {
      if (!current) return
      const id = current.id
      setAnnouncements((previous) =>
        previous.map((announcement) =>
          announcement.id === id
            ? { ...announcement, reactions: transform(announcement.reactions) }
            : announcement
        )
      )
    },
    [current]
  )

  // Adding an emoji: bump and set `me` if the chip exists (no-op when already
  // yours), otherwise append a chip. Reverts if the request fails.
  const onAdd = useCallback(
    async (name: string) => {
      if (!current) return
      const id = current.id
      const previous = current.reactions
      const existing = previous.find((reaction) => reaction.name === name)
      if (existing?.me) return
      mutateReactions((reactions) =>
        reactions.some((reaction) => reaction.name === name)
          ? reactions.map((reaction) =>
              reaction.name === name
                ? { ...reaction, me: true, count: reaction.count + 1 }
                : reaction
            )
          : [...reactions, { name, count: 1, me: true }]
      )
      const ok = await addAnnouncementReaction(id, name).catch(() => false)
      if (!ok) mutateReactions(() => previous)
    },
    [current, mutateReactions]
  )

  // Toggling a chip you own removes your reaction (the chip disappears at 0);
  // toggling one you don't own adds it. Reverts if the DELETE fails.
  const onToggleReaction = useCallback(
    async (name: string) => {
      if (!current) return
      const id = current.id
      const previous = current.reactions
      const existing = previous.find((reaction) => reaction.name === name)
      if (existing?.me) {
        mutateReactions((reactions) =>
          reactions
            .map((reaction) =>
              reaction.name === name
                ? { ...reaction, me: false, count: reaction.count - 1 }
                : reaction
            )
            .filter((reaction) => reaction.count > 0)
        )
        const ok = await removeAnnouncementReaction(id, name).catch(() => false)
        if (!ok) mutateReactions(() => previous)
      } else {
        await onAdd(name)
      }
    },
    [current, mutateReactions, onAdd]
  )

  return {
    announcements,
    current,
    index: safeIndex,
    setIndex,
    unreadCount,
    hasAnnouncements: announcements.length > 0,
    open,
    openPanel,
    close,
    closeAndRefocus,
    focusRequest,
    onAdd,
    onToggleReaction
  }
}

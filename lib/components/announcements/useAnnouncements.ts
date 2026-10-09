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

// The announcements' own controls: the pill or icon and the panel.
export const SURFACE_SELECTOR =
  '[data-announcements-panel],[data-announcements-trigger]'

/**
 * Owns the home timeline's announcement state once: the fetched list, the
 * pager, whether the floating panel is open, the mark-read-on-view timer and
 * the reactions. The page header renders its floating row and its actions in
 * more than one place (the desktop box and the mobile bar), and every copy is
 * presentational over this one state, so there is one fetch, one timer and one
 * open state however many copies mount.
 *
 * Nothing is persisted: the panel opens by itself only while something is
 * unread and is never remembered as open on a later visit.
 */
export interface AnnouncementsState {
  announcements: Announcement[]
  current: Announcement | undefined
  index: number
  setIndex: (updater: (value: number) => number) => void
  unreadCount: number
  /**
   * Decided once, when the announcements load, and never changed for the page
   * session: `pill` if anything was unread on load, `icon` if all were read
   * (the next page load shows the icon once everything has been read). Swapping
   * the control mid-session would unmount the element the reader is using.
   */
  mode: 'none' | 'pill' | 'icon'
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
  // Whether anything was unread on load; fixes `mode` for the page session.
  const [pillOnLoad, setPillOnLoad] = useState(false)
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
        const unread = loaded.some(
          (announcement) => announcement.read === false
        )
        setAnnouncements(loaded)
        setPillOnLoad(unread)
        // Auto-open only while nobody has engaged yet: a reader already typing
        // in the composer keeps the pill collapsed instead of having it covered.
        const focused = document.activeElement
        const idle =
          !focused ||
          focused === document.body ||
          Boolean(focused.closest(SURFACE_SELECTOR))
        setOpenState(unread && idle)
        // Newest first: open on the first unread item, so the one the panel
        // opened for is the one that gets marked read.
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
  // itself). The trigger never changes during the session, so this is just
  // "return focus to the control that opened the panel".
  const closeAndRefocus = useCallback(() => {
    focusRequest.current = true
    close()
  }, [close])

  const openPanel = useCallback(() => {
    // A failed mark-read is retried once per open.
    failed.current.clear()
    setOpenState(true)
  }, [])

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

  const mode: AnnouncementsState['mode'] =
    announcements.length === 0 ? 'none' : pillOnLoad ? 'pill' : 'icon'

  return {
    announcements,
    current,
    index: safeIndex,
    setIndex,
    unreadCount,
    mode,
    open,
    openPanel,
    close,
    closeAndRefocus,
    focusRequest,
    onAdd,
    onToggleReaction
  }
}

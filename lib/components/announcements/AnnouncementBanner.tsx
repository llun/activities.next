'use client'

import {
  ChevronDown,
  ChevronUp,
  Clock,
  Megaphone,
  SmilePlus
} from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { cn } from '@/lib/utils'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'

// Quick-access unicode emoji offered by the reaction picker. Instance-level
// only — no custom per-account stickers (see design spec).
const QUICK_EMOJI = ['👍', '❤️', '🎉', '🔥', '👋', '🙏', '😂', '🚀']

// Counts of 100+ collapse to "99+" per the design voice rules.
const formatCount = (count: number): string => (count > 99 ? '99+' : `${count}`)

// localStorage key for the per-device collapse preference.
const COLLAPSE_STORAGE_KEY = 'announcements:collapsed'

// "Jun 8, 2026" — the published date in the meta row.
const formatPublishedDate = (iso: string): string => {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  return new Date(time).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// "Sat Jun 13, 09:00" for a timed event; "Sat Jun 13" when all-day. Times are
// stored in UTC and rendered in the reader's local timezone.
const formatEventBound = (iso: string, allDay: boolean): string => {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
  if (allDay) return day
  const clock = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
  return `${day}, ${clock}`
}

interface BadgeProps {
  tone?: 'orange' | 'green' | 'gray'
  className?: string
  children: React.ReactNode
}

// Small inline pill used for the unread count, "New" flag, and admin lifecycle
// status. The app has no shared shadcn Badge primitive (NotificationBadge is an
// absolute-positioned overlay), so this maps the design tones to token classes.
export const AnnouncementBadge: FC<BadgeProps> = ({
  tone = 'orange',
  className,
  children
}) => {
  const tones: Record<NonNullable<BadgeProps['tone']>, string> = {
    orange: 'border-primary/30 bg-primary/10 text-primary',
    green:
      'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    gray: 'border-border bg-muted text-muted-foreground'
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

interface ReactionChipProps {
  reaction: AnnouncementReaction
  onToggle: () => void
}

const ReactionChip: FC<ReactionChipProps> = ({ reaction, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={reaction.me}
    aria-label={
      reaction.me
        ? `Remove ${reaction.name} reaction`
        : `Add ${reaction.name} reaction`
    }
    className={cn(
      'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors',
      reaction.me
        ? 'border-primary/45 bg-primary/10 text-primary'
        : 'border-border bg-background text-foreground hover:bg-muted'
    )}
  >
    <span aria-hidden="true">{reaction.name}</span>
    <span className="text-xs font-medium tabular-nums">
      {formatCount(reaction.count)}
    </span>
  </button>
)

interface ReactionPickerProps {
  onPick: (name: string) => void
  onClose: () => void
}

const ReactionPicker: FC<ReactionPickerProps> = ({ onPick, onClose }) => {
  // Escape closes the picker, matching the post-box emoji picker so keyboard
  // users can dismiss it without clicking the outside overlay.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* Outside-click overlay closes the picker. */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Choose a reaction"
        className="bg-popover absolute bottom-9 left-0 z-40 flex gap-1 rounded-xl border p-1.5 shadow-lg"
      >
        {QUICK_EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React with ${emoji}`}
            onClick={() => onPick(emoji)}
            className="hover:bg-muted flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  )
}

interface ReactionRowProps {
  reactions: AnnouncementReaction[]
  onToggle: (name: string) => void
  onAdd: (name: string) => void
}

const ReactionRow: FC<ReactionRowProps> = ({ reactions, onToggle, onAdd }) => {
  const [picking, setPicking] = useState(false)
  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.name}
          reaction={reaction}
          onToggle={() => onToggle(reaction.name)}
        />
      ))}
      <button
        type="button"
        aria-label="Add reaction"
        onClick={() => setPicking((previous) => !previous)}
        className="border-border bg-background text-muted-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
      >
        <SmilePlus className="size-3.5" />
      </button>
      {picking && (
        <ReactionPicker
          onClose={() => setPicking(false)}
          onPick={(emoji) => {
            onAdd(emoji)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

interface AnnouncementBannerProps {
  // Forwarded for consistency with other timeline client components and to keep
  // time-dependent output deterministic between SSR and hydration. The banner
  // never reads the wall clock during render — it uses `currentTime` if it ever
  // needs "now".
  currentTime: number
}

export const AnnouncementBanner: FC<AnnouncementBannerProps> = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [index, setIndex] = useState(0)
  // `null` until the stored preference resolves on mount; until then we render
  // expanded-by-default to avoid an SSR/first-paint flash from reading
  // localStorage during render.
  const [collapsed, setCollapsed] = useState<boolean | null>(null)
  // Ids whose mark-read-on-view timer has already fired, so each announcement
  // dismisses at most once even as the pager moves back and forth. A ref (not
  // state) — it is only ever mutated in place, and its stable identity keeps it
  // out of the mark-read effect's dependency array.
  const dismissed = useRef<Set<string>>(new Set())

  // Load the active announcements (read + unread) once on mount; the banner
  // pages across all of them rather than filtering to unread.
  useEffect(() => {
    let active = true
    getAnnouncements()
      .then((loaded) => {
        if (!active) return
        setAnnouncements(loaded)
      })
      .catch(() => {
        // A failure to load announcements degrades to showing no banner rather
        // than surfacing an error on the timeline.
      })
    return () => {
      active = false
    }
  }, [])

  // Resolve the per-device collapse preference after mount. Default to expanded
  // when there are unread announcements; otherwise respect the stored value.
  useEffect(() => {
    if (collapsed !== null || announcements.length === 0) return
    let stored: string | null = null
    if (typeof window !== 'undefined') {
      try {
        stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY)
      } catch {
        // Ignore storage access errors (private mode, disabled storage).
      }
    }
    if (stored === 'true' || stored === 'false') {
      setCollapsed(stored === 'true')
    } else {
      const hasUnread = announcements.some(
        (announcement) => announcement.read === false
      )
      setCollapsed(!hasUnread)
    }
  }, [announcements, collapsed])

  const isCollapsed = collapsed ?? false
  const unreadCount = useMemo(
    () =>
      announcements.filter((announcement) => announcement.read === false)
        .length,
    [announcements]
  )
  const safeIndex = Math.min(index, Math.max(announcements.length - 1, 0))
  const current = announcements[safeIndex]

  // Mark-read-on-view: an unread, expanded announcement that stays visible for
  // ~900ms fires POST dismiss and flips to read locally. "Dismiss" means mark
  // READ, not remove — the announcement stays in the pager (it just loses the
  // "New" badge) and the orange "{n} new" count drains live. Fired once per id.
  useEffect(() => {
    if (isCollapsed || !current || current.read !== false) return
    if (dismissed.current.has(current.id)) return
    const id = current.id
    const timer = setTimeout(() => {
      dismissed.current.add(id)
      setAnnouncements((previous) =>
        previous.map((announcement) =>
          announcement.id === id
            ? { ...announcement, read: true }
            : announcement
        )
      )
      void dismissAnnouncement(id)
    }, 900)
    return () => clearTimeout(timer)
  }, [current, isCollapsed])

  const toggleCollapsed = useCallback(() => {
    // Compute the next value from current state and set it directly; the
    // localStorage write is a side effect kept out of the state updater (which
    // must stay pure — React may re-invoke it under StrictMode/concurrency).
    const next = !(collapsed ?? false)
    setCollapsed(next)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
      } catch {
        // Ignore storage write failures.
      }
    }
  }, [collapsed])

  // Applies a reaction transform to the currently visible announcement only.
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

  // Adding an emoji: bump + set `me` if the chip exists (no-op when already
  // yours), otherwise append a new chip. Always PUT, reverting the optimistic
  // chip/count if the request fails (mirrors AnnouncementsPanel's rollback).
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

  // Toggling a chip you own removes your reaction (count-1; the chip disappears
  // at 0) and calls DELETE. Toggling one you don't own adds your reaction.
  // Reverts the optimistic update if the DELETE fails.
  const onToggle = useCallback(
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

  // The HTML content is server-rendered and sanitized by the status pipeline
  // (convertMarkdownText -> sanitizeText -> sanitizeTrustedStatusText). The only
  // remaining step is turning that HTML into React nodes via cleanClassName — we
  // never use dangerouslySetInnerHTML.
  const content = useMemo(
    () => (current ? cleanClassName(current.content) : null),
    [current]
  )

  if (announcements.length === 0) return null
  if (!current) return null

  const hasMultiple = announcements.length > 1
  const eventStart = current.starts_at
    ? formatEventBound(current.starts_at, current.all_day)
    : null
  // Render the end bound whenever one exists, including all-day events spanning
  // multiple days. formatEventBound strips the clock when all_day is true, so an
  // all-day range shows dates only and never leaks a time.
  const eventEnd = current.ends_at
    ? formatEventBound(current.ends_at, current.all_day)
    : null

  return (
    <div className="bg-background/80 rounded-2xl border shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!isCollapsed}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg">
          <Megaphone className="size-[15px]" />
        </span>
        <span className="text-sm font-semibold">Announcements</span>
        {unreadCount > 0 && (
          <AnnouncementBadge tone="orange">
            {formatCount(unreadCount)} new
          </AnnouncementBadge>
        )}
        <span className="text-muted-foreground ml-auto flex items-center gap-2">
          {!isCollapsed && hasMultiple && (
            <span className="text-xs tabular-nums">
              {safeIndex + 1} / {announcements.length}
            </span>
          )}
          {isCollapsed ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </span>
      </button>

      {!isCollapsed && (
        <div className="space-y-3 border-t px-4 pt-3 pb-4">
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span suppressHydrationWarning>
              {formatPublishedDate(current.published_at)}
            </span>
            {eventStart && (
              <span className="text-primary flex items-center gap-1 font-medium">
                <Clock className="size-3" />
                <span suppressHydrationWarning>
                  {eventStart}
                  {eventEnd ? ` – ${eventEnd}` : ''}
                </span>
              </span>
            )}
            {current.read === false && (
              <AnnouncementBadge tone="orange">New</AnnouncementBadge>
            )}
          </div>

          <div className="text-sm leading-relaxed break-words [&_a]:text-sky-600 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-sky-400 [&_p]:mb-2 last:[&_p]:mb-0">
            {content}
          </div>

          <div className="flex items-end justify-between gap-3">
            <ReactionRow
              reactions={current.reactions}
              onToggle={onToggle}
              onAdd={onAdd}
            />
            {hasMultiple && (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label="Previous announcement"
                  disabled={safeIndex === 0}
                  onClick={() => setIndex((value) => Math.max(value - 1, 0))}
                  className="border-border bg-background hover:bg-muted flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:opacity-40"
                >
                  <ChevronUp className="size-3.5 -rotate-90" />
                </button>
                <button
                  type="button"
                  aria-label="Next announcement"
                  disabled={safeIndex === announcements.length - 1}
                  onClick={() =>
                    setIndex((value) =>
                      Math.min(value + 1, announcements.length - 1)
                    )
                  }
                  className="border-border bg-background hover:bg-muted flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:opacity-40"
                >
                  <ChevronDown className="size-3.5 -rotate-90" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

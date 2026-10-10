'use client'

import {
  ChevronDown,
  ChevronUp,
  Clock,
  Megaphone,
  SmilePlus
} from 'lucide-react'
import { FC, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import type { AnnouncementReaction } from '@/lib/types/mastodon/announcement'
import { cn } from '@/lib/utils'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'

import { formatEventTime } from './formatEventTime'
import type { AnnouncementsState } from './useAnnouncements'

// The announcements' own controls: the header icon and the panel.
const SURFACE_SELECTOR =
  '[data-announcements-panel],[data-announcements-trigger]'

// Quick-access unicode emoji offered by the reaction picker. Instance-level
// only — no custom per-account stickers (see design spec).
const QUICK_EMOJI = ['👍', '❤️', '🎉', '🔥', '👋', '🙏', '😂', '🚀']

// Counts of 100+ collapse to "99+" per the design voice rules.
const formatCount = (count: number): string => (count > 99 ? '99+' : `${count}`)

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

interface BadgeProps {
  tone?: 'orange' | 'green' | 'gray'
  className?: string
  children: React.ReactNode
}

// Small inline pill used for the "New" flag and the admin lifecycle
// status, mapping the design tones to theme-token classes.
export const AnnouncementBadge: FC<BadgeProps> = ({
  tone = 'orange',
  className,
  children
}) => {
  const tones: Record<NonNullable<BadgeProps['tone']>, string> = {
    orange: 'border-primary/30 bg-primary/10 text-primary-text',
    green: 'border-success/30 bg-success/10 text-success-text',
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
        ? 'border-primary/45 bg-primary/10 text-primary-text'
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
  /** Escape: closes and returns focus to the trigger. */
  onEscape: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const ReactionPicker: FC<ReactionPickerProps> = ({
  onPick,
  onClose,
  onEscape,
  anchorRef
}) => {
  // Escape closes the picker, matching the post-box emoji picker. A pointer
  // press outside the picker and its trigger closes it too: a document
  // listener rather than a fixed backdrop, because the header's backdrop
  // filter would make a fixed overlay cover only the header.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        anchorRef.current?.contains(event.target)
      ) {
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose, onEscape, anchorRef])

  return (
    <div
      data-announcement-picker
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
  )
}

interface ReactionRowProps {
  reactions: AnnouncementReaction[]
  onToggle: (name: string) => void
  onAdd: (name: string) => void
}

const ReactionRow: FC<ReactionRowProps> = ({ reactions, onToggle, onAdd }) => {
  const [picking, setPicking] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  return (
    <div ref={rowRef} className="relative flex flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.name}
          reaction={reaction}
          onToggle={() => onToggle(reaction.name)}
        />
      ))}
      <button
        ref={addRef}
        type="button"
        aria-label="Add reaction"
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => setPicking((previous) => !previous)}
        className="border-border bg-background text-muted-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
      >
        <SmilePlus className="size-3.5" />
      </button>
      {picking && (
        <ReactionPicker
          anchorRef={rowRef}
          onClose={() => setPicking(false)}
          onEscape={() => {
            setPicking(false)
            addRef.current?.focus()
          }}
          onPick={(emoji) => {
            onAdd(emoji)
            setPicking(false)
            addRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

interface AnnouncementsViewProps {
  state: AnnouncementsState
}

// The panel is a popover under the header, centred to the content column. It
// closes from its trigger, an outside press, focus moving to a control outside
// it, or Escape; closing never writes storage, and Escape and the trigger
// return focus to the trigger. Several copies can exist (the header renders its
// actions in both the desktop box and the mobile bar), so "inside" means inside
// any announcements surface.
const AnnouncementsPanel: FC<{
  state: AnnouncementsState
  id: string
}> = ({ state, id }) => {
  const { announcements, current, index, setIndex, onAdd, onToggleReaction } =
    state
  // The HTML content is server-rendered and sanitized by the status pipeline
  // (convertMarkdownText -> sanitizeText -> sanitizeTrustedStatusText); we only
  // turn it into React nodes via cleanClassName, never dangerouslySetInnerHTML.
  const html = current?.content
  const content = useMemo(
    () => (html === undefined ? null : cleanClassName(html)),
    [html]
  )
  if (!current) return null
  const hasMultiple = announcements.length > 1
  // "Sat Jun 13, 09:00 – 10:00 UTC"; all-day events show dates only.
  const eventTime = formatEventTime({
    startsAt: current.starts_at,
    endsAt: current.ends_at,
    allDay: current.all_day
  })

  return (
    <div
      id={id}
      role="region"
      aria-label="Announcements"
      data-announcements-panel
      onBlur={closeOnFocusOut(state.close)}
      className="bg-popover text-popover-foreground pointer-events-auto absolute inset-x-0 top-full z-30 mx-auto mt-2 max-h-[60vh] w-[calc(100%-2rem)] max-w-[calc(var(--container-content)-2rem)] space-y-3 overflow-y-auto rounded-lg border p-4 text-left shadow-lg"
    >
      {hasMultiple && (
        <div className="text-muted-foreground text-xs tabular-nums">
          {index + 1} / {announcements.length}
        </div>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{formatPublishedDate(current.published_at)}</span>
        {eventTime && (
          <span className="text-primary-text flex items-center gap-1 font-medium">
            <Clock className="size-3 text-primary" />
            <span>{eventTime}</span>
          </span>
        )}
        {current.read === false && (
          <AnnouncementBadge tone="orange">New</AnnouncementBadge>
        )}
      </div>

      <div className="text-sm leading-relaxed break-words [&_a]:text-(color:--link-color) [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-(color:--link-color-hover) [&_p]:mb-2 last:[&_p]:mb-0">
        {content}
      </div>

      <div className="flex items-end justify-between gap-3">
        <ReactionRow
          reactions={current.reactions}
          onToggle={onToggleReaction}
          onAdd={onAdd}
        />
        {hasMultiple && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label="Previous announcement"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(value - 1, 0))}
              className="border-border bg-background hover:bg-muted flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:opacity-40"
            >
              <ChevronUp className="size-3.5 -rotate-90" />
            </button>
            <button
              type="button"
              aria-label="Next announcement"
              disabled={index === announcements.length - 1}
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
  )
}

// While the panel is open: a press outside every announcements surface closes
// it, and so does Escape, handled on the document rather than on the panel so
// it still works when focus has fallen to the body inside it (a disabled pager
// button, a removed reaction chip). Escape is taken only when focus is on the
// body or inside a surface, so another control's Escape (the composer's emoji
// picker, a lightbox) is not swallowed, and the open reaction picker takes its
// own Escape first. Focus returns to the trigger.
const useDismissWhileOpen = (active: boolean, state: AnnouncementsState) => {
  const { close, closeAndRefocus } = state
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(SURFACE_SELECTOR)
      ) {
        return
      }
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[data-announcement-picker]')) return
      const focused = document.activeElement
      const onBody = !focused || focused === document.body
      if (!onBody && !focused.closest(SURFACE_SELECTOR)) return
      // Leave an Escape alone when focus is on the body: nothing else claimed
      // it, and a later listener (the lightbox) may still want it.
      if (!onBody) event.preventDefault()
      closeAndRefocus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active, close, closeAndRefocus])
}

// Takes focus after a close that asked for it. A hidden copy's focus() does
// nothing, so every mounted trigger just tries.
const useTakeFocusRequest = (
  state: AnnouncementsState,
  ref: React.RefObject<HTMLButtonElement | null>
) => {
  const { open, focusRequest } = state
  useEffect(() => {
    if (open || !focusRequest.current) return
    ref.current?.focus()
    if (ref.current && document.activeElement === ref.current) {
      focusRequest.current = false
    }
  }, [open, focusRequest, ref])
}

// Focus moving from the panel or its trigger to somewhere outside every
// announcements surface closes the panel, so keyboard focus never lands on
// content the panel covers. Focus is not moved, and focus going nowhere
// (a removed button, the window losing focus) leaves it open.
const closeOnFocusOut =
  (close: () => void) => (event: React.FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget
    if (next instanceof Element && !next.closest(SURFACE_SELECTOR)) close()
  }

/**
 * The header action for announcements: a Refresh-style icon button beside
 * Refresh, so it never takes space in the header. It is shown whenever there is
 * at least one active announcement, read or unread, and opens the panel under
 * the header. While anything is unread it carries a small dot in the primary
 * token and names the count ("Announcements, 2 new"); the dot drains live as
 * the mark-read-on-view timer marks items read.
 */
export const AnnouncementIconButton: FC<AnnouncementsViewProps> = ({
  state
}) => {
  const {
    hasAnnouncements,
    open,
    close,
    closeAndRefocus,
    openPanel,
    unreadCount
  } = state
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  useDismissWhileOpen(open, state)
  useTakeFocusRequest(state, triggerRef)
  if (!hasAnnouncements) return null

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="icon"
        data-announcements-trigger
        onClick={open ? closeAndRefocus : openPanel}
        onBlur={closeOnFocusOut(close)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          unreadCount > 0
            ? `Announcements, ${formatCount(unreadCount)} new`
            : 'Announcements'
        }
        className="group relative dark:border-border dark:bg-card dark:hover:bg-accent"
      >
        <Megaphone className="size-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            data-announcements-unread-dot
            className="bg-primary ring-card group-hover:ring-accent absolute top-1.5 right-1.5 size-2 rounded-full ring-2"
          />
        )}
      </Button>
      {open && <AnnouncementsPanel state={state} id={panelId} />}
    </>
  )
}

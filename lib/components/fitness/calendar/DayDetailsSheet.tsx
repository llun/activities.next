'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatFullDate } from '@/lib/fitness/calendar/format'

import {
  CloseButton,
  DayDetailsBody,
  DayDetailsContentProps,
  closeOnEscape,
  dayAnnouncement,
  formatDayTotals
} from './DayDetails'

export interface DayDetailsSheetProps extends DayDetailsContentProps {
  /**
   * Height of the collapsed sheet, a number of pixels or a CSS length. The
   * parent sizes it so the selected cell stays visible above the sheet.
   */
  collapsedMaxHeight?: number | string
  /** Height limit of the expanded sheet; the sheet scrolls inside it. */
  expandedMaxHeight?: number | string
  /** Reports the sheet's rendered height, for scroll padding under it. */
  onHeightChange?: (height: number) => void
}

const cssLength = (value: number | string) =>
  typeof value === 'number' ? `${value}px` : value

/**
 * The mobile day details: a NONMODAL bottom sheet. No scrim, no focus trap, no
 * `aria-modal`, so the grid behind stays usable and focus stays on the cell
 * that opened it. It has an explicit Close and Expand/Collapse (44px), a sticky
 * date header, a "+N more" cue while collapsed, internal scroll and safe-area
 * padding. Nothing needs dragging. It rises 16px and fades in over 200ms
 * (opacity only under reduced motion).
 */
export function DayDetailsSheet({
  date,
  timeZone,
  totals,
  activities,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
  onClose,
  collapsedMaxHeight = 'min(40dvh, 280px)',
  expandedMaxHeight = 'min(80dvh, 640px)',
  onHeightChange
}: DayDetailsSheetProps) {
  const headingId = useId()
  const bodyId = useId()
  const sheetRef = useRef<HTMLElement>(null)
  // Expansion belongs to a day: selecting another day collapses the sheet.
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const expanded = expandedDate === date
  const toggle = () => setExpandedDate(expanded ? null : date)

  const total = Math.max(totals?.count ?? 0, activities.length)
  const hidden = Math.max(0, total - 1)
  const settled = !loading && !error

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || !onHeightChange || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() =>
      onHeightChange(sheet.getBoundingClientRect().height)
    )
    observer.observe(sheet)
    onHeightChange(sheet.getBoundingClientRect().height)
    return () => observer.disconnect()
  }, [onHeightChange])

  if (typeof document === 'undefined') return null

  const ToggleChevron = expanded ? ChevronDown : ChevronUp
  return createPortal(
    <section
      ref={sheetRef}
      role="region"
      aria-labelledby={headingId}
      data-testid="day-details-sheet"
      data-expanded={expanded}
      onKeyDown={closeOnEscape(onClose)}
      style={{
        maxHeight: cssLength(expanded ? expandedMaxHeight : collapsedMaxHeight)
      }}
      className="bg-background dark:bg-card animate-in fade-in-0 slide-in-from-bottom-4 motion-reduce:slide-in-from-bottom-0 fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-y-auto overscroll-contain rounded-t-2xl border-t pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgb(0_0_0/0.12)] duration-200 ease-out"
    >
      <header className="bg-background dark:bg-card sticky top-0 z-10 shrink-0 rounded-t-2xl px-4 pt-2">
        <div
          aria-hidden="true"
          className="bg-muted-foreground/30 mx-auto mb-1 h-1 w-9 rounded-full"
        />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 py-1">
            <h3 id={headingId} className="text-base font-semibold">
              {formatFullDate(date)}
            </h3>
            <p className="text-muted-foreground text-xs">
              {formatDayTotals(totals)}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={
                expanded ? 'Collapse day details' : 'Expand day details'
              }
              onClick={toggle}
              className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2"
            >
              <ToggleChevron className="size-5" aria-hidden="true" />
            </button>
            <CloseButton onClose={onClose} />
          </div>
        </div>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {settled ? dayAnnouncement(date, totals, activities.length) : ''}
      </p>
      <div id={bodyId} className="px-4 pb-3">
        <DayDetailsBody
          activities={activities}
          timeZone={timeZone}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={hasMore}
          onRetry={onRetry}
          onLoadMore={onLoadMore}
          limit={expanded ? undefined : 1}
        />
        {!expanded && hidden > 0 && (
          <button
            type="button"
            onClick={toggle}
            className="text-primary-text focus-visible:ring-ring min-h-11 rounded-md text-sm font-medium outline-none focus-visible:ring-2"
          >
            +{hidden} more {hidden === 1 ? 'activity' : 'activities'} · Expand
          </button>
        )}
      </div>
    </section>,
    document.body
  )
}

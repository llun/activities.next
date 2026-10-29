'use client'

import { type FC, useEffect, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { normalizeActivityTypeToSportKey } from '@/lib/services/fitness-files/sportTypes'
import type {
  GalleryDayKey,
  GalleryDayStats
} from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

import { formatActivityTitle } from './galleryActivityLabel'
import {
  SPORT_EMOJI,
  UNDATED_DAY_KEY,
  formatDayHeading,
  formatDayHeadingParts,
  formatDayMeta,
  getSelectDayAction
} from './galleryDayGroups'

export interface GalleryDayHeaderProps {
  dayKey: GalleryDayKey
  /** Server numbers; absent → loadedCount/loadedInAlbum stand in. */
  stats?: GalleryDayStats
  loadedCount: number
  loadedInAlbum: number
  picked: number
  /** Show picked text and the Select day button. */
  selecting: boolean
  /** Add photos: "N in album" / "All in album". */
  hasAlbum: boolean
  /** Null: no capacity (All media). */
  room: number | null
  /** Any non-null key disables every day action; the matching day shows progress. */
  busyKey?: GalleryDayKey | null
  /** Ids fetched so far for the busy day's read (its progress label). */
  busyCount?: number
  disabled?: boolean
  onSelectDay: (key: GalleryDayKey, take: number) => void
  onDeselectDay: (key: GalleryDayKey) => void
  /** h3 inside the dialog (its title is h2), h2 on All media. */
  as?: 'h2' | 'h3'
  /**
   * Where the header sticks. `'dialog'` (default) keeps the album picker's
   * look: the host's `className` supplies the sticky offset and background.
   * `'page'` is transparent at rest and gains the house chrome surface
   * (`bg-surface-chrome` + backdrop blur + hairline) while stuck, via a
   * sentinel observed before the header.
   */
  surface?: 'page' | 'dialog'
  /** The host's sticky offset + background classes. */
  className?: string
}

/**
 * One day's sticky header: the date, the meta line, the activity chip and,
 * while selecting, the Select day button. The host supplies the sticky
 * offset and background through `className`.
 */
export const GalleryDayHeader: FC<GalleryDayHeaderProps> = ({
  dayKey,
  stats,
  loadedCount,
  loadedInAlbum,
  picked,
  selecting,
  hasAlbum,
  room,
  busyKey = null,
  busyCount = 0,
  disabled = false,
  onSelectDay,
  onDeselectDay,
  as = 'h3',
  surface = 'dialog',
  className
}) => {
  const Heading = as
  const isPage = surface === 'page'
  const [stuck, setStuck] = useState(false)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Stuck when the sentinel just above the header has scrolled behind the
  // sticky offset: the observer's top rootMargin is minus that offset, so the
  // sentinel only leaves the shrunken viewport once the header is pinned.
  // The offset differs between phone and md, so it is read off the header's
  // computed `top` when the observer is set up. No observer (SSR, jsdom)
  // means never stuck.
  useEffect(() => {
    const header = headerRef.current
    const sentinel = sentinelRef.current
    if (!isPage || !header || !sentinel) return
    if (typeof IntersectionObserver === 'undefined') return
    const offset = Number.parseFloat(getComputedStyle(header).top)
    const rootMargin = Number.isFinite(offset)
      ? `-${offset}px 0px 0px 0px`
      : '0px'
    const observer = new IntersectionObserver(
      (entries) => setStuck(!entries[0].isIntersecting),
      { rootMargin }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isPage])
  const count = stats?.count ?? loadedCount
  const inAlbum = stats?.inAlbum ?? loadedInAlbum
  const placeName = stats?.placeName ?? null
  const meta = { placeName, count, picked, inAlbum, selecting }
  const action =
    selecting && dayKey !== UNDATED_DAY_KEY
      ? getSelectDayAction({ count, inAlbum, picked, room, hasAlbum })
      : null

  const activity = stats?.activity ?? null
  const sportKey = activity
    ? normalizeActivityTypeToSportKey(activity.activityType)
    : null
  const activityEmoji = sportKey ? (SPORT_EMOJI[sportKey] ?? null) : null
  const activityTitle = activity
    ? formatActivityTitle(
        {
          activityType: activity.activityType,
          distanceMeters: activity.distanceMeters
        },
        activity.id
      )
    : null
  const busy = busyKey === dayKey
  // The busy label follows the pending action, so a Deselect day read
  // never says "Selecting…" on a button named "Deselect day, <date>".
  const busyLabel = action?.kind === 'deselect' ? 'Deselecting…' : 'Selecting…'
  // The two-row phone layout exists to give the Select day button its
  // own corner; without one, phones keep the single flex row.
  const twoRow = action !== null

  // The date first; an upload day's "Uploaded" is a muted suffix beside it.
  const renderHeadingDate = (short: boolean) => {
    const parts = formatDayHeadingParts(dayKey, { short })
    return (
      <>
        {parts.day}
        {parts.uploaded ? (
          <span className="text-muted-foreground font-normal"> · Uploaded</span>
        ) : null}
      </>
    )
  }

  const header = (
    <div
      ref={headerRef}
      data-stuck={isPage && stuck ? 'true' : undefined}
      className={cn(
        'sticky z-10 py-1.5',
        twoRow
          ? 'max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1'
          : 'flex items-center gap-2',
        'sm:flex sm:items-center sm:gap-2',
        // The page surface is transparent at rest; stuck it takes the
        // chrome surface, blur and hairline of the title band, spanning
        // the content column edge to edge (the column's padding is
        // pulled in, then added back so text aligns with the tiles).
        isPage && [
          '-mx-4 px-4',
          'data-[stuck]:border-b data-[stuck]:bg-surface-chrome data-[stuck]:backdrop-blur'
        ],
        className
      )}
    >
      <Heading
        className={cn(
          'shrink-0',
          // The page surface's date reads slightly larger than the
          // dialog's; the dialog keeps today's text-sm.
          isPage ? 'text-[15px] font-semibold' : 'text-sm font-semibold',
          twoRow && 'max-sm:min-w-0 max-sm:truncate'
        )}
      >
        <span className="max-sm:hidden">{renderHeadingDate(false)}</span>
        <span className="sm:hidden">{renderHeadingDate(true)}</span>
      </Heading>
      {/* Row 2 below sm when there is an action; `contents` keeps the
          one-row layout's flat structure everywhere else. The meta line
          may wrap, and pieces that cannot wrap truncate through
          min-w-0. */}
      <div
        className={
          twoRow
            ? 'max-sm:col-span-2 max-sm:row-start-2 max-sm:flex max-sm:min-w-0 max-sm:flex-wrap max-sm:items-center max-sm:gap-2 sm:contents'
            : 'contents'
        }
      >
        <p
          className={cn(
            'text-muted-foreground min-w-0 text-xs',
            twoRow || isPage ? 'truncate' : 'max-sm:shrink-0 sm:truncate'
          )}
        >
          <span className="max-sm:hidden">{formatDayMeta(meta)}</span>
          {/* On the page surface phones keep the place name, truncating
              via min-w-0; the dialog drops it as before. */}
          <span
            className={cn(
              'sm:hidden whitespace-nowrap',
              isPage && 'min-w-0 truncate'
            )}
          >
            {formatDayMeta({
              ...meta,
              placeName: isPage ? placeName : null,
              short: true
            })}
          </span>
        </p>
        {activity && activityTitle ? (
          <>
            <span className="hidden items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap sm:inline-flex">
              {activityEmoji ? (
                <span aria-hidden="true">{activityEmoji} </span>
              ) : null}
              {activityTitle}
            </span>
            {/* Phones show the emoji and the title (activity name and
              distance) like the wider chip, truncating via min-w-0
              when the row cannot fit them. */}
            <span className="inline-block min-w-0 truncate rounded-full border px-2 py-0.5 text-xs sm:hidden">
              {activityEmoji ? (
                <>
                  <span aria-hidden="true">{activityEmoji} </span>
                  {activityTitle}
                </>
              ) : (
                activityTitle
              )}
            </span>
          </>
        ) : null}
      </div>
      {action ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="pointer-coarse:min-h-11 ml-auto shrink-0 max-sm:col-start-2 max-sm:row-start-1 aria-disabled:pointer-events-none aria-disabled:opacity-50"
          disabled={disabled}
          aria-disabled={action.disabled || busyKey !== null || undefined}
          aria-label={`${action.label}, ${formatDayHeading(dayKey)}`}
          onClick={() => {
            if (disabled || action.disabled || busyKey !== null) return
            if (action.kind === 'deselect') onDeselectDay(dayKey)
            else onSelectDay(dayKey, action.take)
          }}
        >
          {busy ? (
            busyCount > 0 ? (
              `${busyLabel} ${busyCount.toLocaleString('en-US')}`
            ) : (
              busyLabel
            )
          ) : (
            <>
              <span className="hidden sm:inline">{action.label}</span>
              <span className="sm:hidden">{action.short}</span>
            </>
          )}
        </Button>
      ) : null}
    </div>
  )

  if (!isPage) return header
  // The 1px sentinel the observer watches sits directly above the sticky
  // header, so it leaves the shrunken viewport exactly when the header pins.
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {header}
    </>
  )
}

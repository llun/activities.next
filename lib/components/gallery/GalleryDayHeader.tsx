'use client'

import { type FC } from 'react'

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
  className
}) => {
  const Heading = as
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

  return (
    <div
      className={cn('sticky z-10 flex items-center gap-2 py-1.5', className)}
    >
      <Heading className="text-sm font-semibold shrink-0">
        <span className="max-sm:hidden">{formatDayHeading(dayKey)}</span>
        <span className="sm:hidden">
          {formatDayHeading(dayKey, { short: true })}
        </span>
      </Heading>
      <p className="text-muted-foreground max-sm:shrink-0 min-w-0 text-xs sm:truncate">
        <span className="max-sm:hidden">{formatDayMeta(meta)}</span>
        <span className="sm:hidden whitespace-nowrap">
          {formatDayMeta({ ...meta, placeName: null, short: true })}
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
              distance) like the wider chip, truncating first so the
              count · picked meta is never cut off. */}
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
      {action ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="pointer-coarse:h-10 ml-auto shrink-0 aria-disabled:pointer-events-none aria-disabled:opacity-50"
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
}

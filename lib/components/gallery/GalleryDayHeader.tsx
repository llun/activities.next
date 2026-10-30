'use client'

import {
  type FC,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'

import { breakoutStyle } from '@/lib/components/layout/chromeLayout'
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
   * `'page'` draws its own background — transparent at rest, the house
   * Surface Chrome token (plus backdrop blur and a hairline) while stuck,
   * via a sentinel observed before the header — so the host's
   * `className` only supplies the sticky offset there.
   */
  surface?: 'page' | 'dialog'
  /**
   * The host's sticky offset; on the dialog surface, the background too
   * (the page surface draws its own).
   */
  className?: string
}

// The sticky offset moves when the viewport crosses md (48rem) or the
// connection strip's measured `--status-strip-h` changes. Every page-surface
// header needs to know, but they share ONE subscription: a single
// matchMedia listener and a single MutationObserver on <html>, created
// lazily with the first subscriber and torn down with the last, so N
// headers cost one observer and an unrelated <html> style change (the
// photo viewer's overflow toggle, color-scheme) cannot rebuild N
// IntersectionObservers. The snapshot is an epoch that increments only when
// the md match or the `--status-strip-h` value actually changed.
interface StickyOffsetStore {
  listeners: Set<() => void>
  release: () => void
}

let stickyOffsetStore: StickyOffsetStore | null = null

// The epoch is module-level and only ever increases: the store dies with
// its last header and is rebuilt from scratch (GalleryPagedGrid remounts
// on every filter change), and a per-store counter would restart at 0 —
// a lower snapshot than the remounted headers rendered with, so each
// would re-render and build a second IntersectionObserver for nothing.
let stickyOffsetEpoch = 0

const getStickyOffsetEpoch = () => stickyOffsetEpoch

const getServerStickyOffsetEpoch = () => 0

const createStickyOffsetStore = (): StickyOffsetStore => {
  const listeners = new Set<() => void>()
  const root = document.documentElement
  let stripH = root.style.getPropertyValue('--status-strip-h')
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 48rem)')
      : null
  let md = media?.matches ?? false
  const store: StickyOffsetStore = {
    listeners,
    release: () => {
      media?.removeEventListener('change', onMaybeMove)
      mutations?.disconnect()
    }
  }
  const onMaybeMove = () => {
    const nextStripH = root.style.getPropertyValue('--status-strip-h')
    const nextMd = media?.matches ?? md
    if (nextStripH === stripH && nextMd === md) return
    stripH = nextStripH
    md = nextMd
    stickyOffsetEpoch += 1
    for (const listener of listeners) listener()
  }
  media?.addEventListener('change', onMaybeMove)
  const mutations =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(onMaybeMove)
  mutations?.observe(root, {
    attributes: true,
    attributeFilter: ['style']
  })
  return store
}

const subscribeStickyOffsets = (onStoreChange: () => void): (() => void) => {
  const store = stickyOffsetStore ?? createStickyOffsetStore()
  stickyOffsetStore = store
  store.listeners.add(onStoreChange)
  return () => {
    store.listeners.delete(onStoreChange)
    if (store.listeners.size === 0 && stickyOffsetStore === store) {
      store.release()
      stickyOffsetStore = null
    }
  }
}

const subscribeToNothing = () => () => {}

/**
 * One day's sticky header: the date, the meta line, the activity chip and,
 * while selecting, the Select day button. The host supplies the sticky
 * offset through `className`; on the dialog surface the background too.
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
  // The shared offset epoch (see the store above) re-creates the observer
  // so it re-reads the header's computed `top`. The dialog surface never
  // pins and never subscribes.
  const offsetEpoch = useSyncExternalStore(
    isPage ? subscribeStickyOffsets : subscribeToNothing,
    getStickyOffsetEpoch,
    getServerStickyOffsetEpoch
  )

  // Stuck when the sentinel just above the header has scrolled behind the
  // sticky offset: the observer's top rootMargin is minus that offset, so the
  // sentinel only leaves the shrunken viewport once the header is pinned.
  // The offset differs between phone and md, and with --status-strip-h, so a
  // matching media query or a style mutation on <html> re-creates the
  // observer (see the shared offset store above). No observer (SSR, jsdom)
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
      (entries) => {
        // One callback can batch several entries; the newest one is the
        // sentinel's current position, so it wins over the older ones.
        const entry = entries[entries.length - 1]
        if (!entry) return
        // Stuck once the sentinel has crossed above the shrunken
        // viewport's top edge, not merely when it stops intersecting:
        // scrolling back down, the 1px sentinel can re-enter straddling
        // the root top (intersecting, but its top above the edge), and
        // that must read as back in flow.
        setStuck(
          !entry.isIntersecting &&
            entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)
        )
      },
      { rootMargin }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isPage, offsetEpoch])
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

  // The header's one row: the date, the meta line, the activity chip and,
  // while selecting, the Select day button. On the dialog surface this is
  // the header box itself; on the page surface it sits inside the breakout
  // box, re-centred at `max-w-content` so it stays aligned with the tiles.
  const rowClassName = cn(
    'py-1.5',
    twoRow
      ? 'max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1'
      : 'flex items-center gap-2',
    'sm:flex sm:items-center sm:gap-2'
  )

  const row = (
    <>
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
    </>
  )

  // The dialog surface keeps the single box the album picker has always
  // hosted: its `className` supplies the sticky offset and background.
  if (!isPage) {
    return (
      <div
        ref={headerRef}
        className={cn('sticky z-10', rowClassName, className)}
      >
        {row}
      </div>
    )
  }

  // The page surface is transparent at rest; stuck it takes the chrome
  // surface, blur and hairline of the title band. The box breaks out of
  // the content column exactly the way the title band does
  // (`breakoutStyle`, as `PageHeader` applies it), so the frosted strip
  // spans the content pane edge to edge, while the row inside re-centres
  // at `max-w-content` so the date and the Select day button keep the
  // grid's edges. The hairline is a shadow, not a border: pinning must
  // not grow the header and shift the tiles.
  return (
    <>
      {/* The 1px sentinel the observer watches sits directly above the sticky
          header, so it leaves the shrunken viewport exactly when the header pins. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div
        ref={headerRef}
        data-stuck={stuck ? 'true' : undefined}
        className={cn(
          'sticky z-10',
          'data-[stuck]:bg-surface-chrome data-[stuck]:backdrop-blur data-[stuck]:shadow-[0_1px_0_var(--border)]',
          className
        )}
        style={breakoutStyle}
      >
        <div className={cn('mx-auto max-w-content px-4', rowClassName)}>
          {row}
        </div>
      </div>
    </>
  )
}

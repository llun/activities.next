'use client'

import { ChevronDown, Download, Watch } from 'lucide-react'
import { FC } from 'react'

import type { StatusFitnessFileItem } from '@/lib/client'
import { BrandedDeviceLink } from '@/lib/components/posts/BrandedDeviceLink'
import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  formatFitnessDistance,
  formatFitnessDuration
} from '@/lib/utils/fitness'
import { getDeviceDisplayLabel } from '@/lib/utils/fitnessDeviceBrands'

type RecordingFile = Pick<
  StatusFitnessFileItem,
  'deviceGearName' | 'deviceName' | 'deviceManufacturer' | 'fileName'
>

/**
 * The device a recording was made on, or null when nothing names one. The gear
 * row's name overrides the recorded one, so this is non-null whenever EITHER is
 * present — a device renamed to something the brand map cannot resolve would
 * otherwise vanish from the page.
 */
export const getRecordingDeviceLabel = (
  file: Pick<
    RecordingFile,
    'deviceGearName' | 'deviceName' | 'deviceManufacturer'
  >
): string | null =>
  file.deviceGearName?.trim() ||
  getDeviceDisplayLabel(file.deviceName, file.deviceManufacturer)

/**
 * What a recording is called wherever several are listed: its device, else its
 * file name. A status can hold files with no device information at all (a GPX
 * export has none), and a row with no name would be unpickable.
 */
export const getRecordingLabel = (file: RecordingFile): string =>
  getRecordingDeviceLabel(file) || file.fileName

// `<distance> · <elapsed time> · <TYPE>`, each part skipped when the file has
// no value for it. Elapsed rather than moving time: the rows tell recordings of
// one ride apart, and a watch and a head unit disagree most on what they called
// a stop.
const getRecordingSummary = (file: StatusFitnessFileItem): string =>
  [
    formatFitnessDistance(file.totalDistanceMeters ?? undefined),
    formatFitnessDuration(file.totalDurationSeconds ?? undefined),
    file.fileType.toUpperCase()
  ]
    .filter(Boolean)
    .join(' · ')

const OUTLINE_SQUARE_BUTTON =
  'inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50'

/**
 * The selected recording's download. `href` is set only for the owner:
 * `GET /api/v1/fitness-files/:id` serves the original upload, which still holds
 * the ends a privacy location trims off the map and the route data, so it is
 * owner-only and a link shown to anyone else would only 404.
 */
const DownloadRecordingButton: FC<{
  href: string
  fileType: string
  /** Visible text for the line that has nothing else to say. */
  label?: string
}> = ({ href, fileType, label }) => {
  const name = `Download ${fileType.toUpperCase()} file`
  return (
    <a
      href={href}
      title={name}
      aria-label={label ? undefined : name}
      className={cn(
        OUTLINE_SQUARE_BUTTON,
        label && 'w-auto gap-1.5 px-2.5 text-sm font-medium'
      )}
    >
      <Download className="size-3.5" aria-hidden="true" />
      {label ? (
        <>
          <span>{label}</span>
          <span className="sr-only"> ({name.toLowerCase()})</span>
        </>
      ) : null}
    </a>
  )
}

const PRIMARY_PILL =
  'shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground'

const RecordingPicker: FC<{
  files: StatusFitnessFileItem[]
  selected: StatusFitnessFileItem
  onSelect: (fileId: string) => void
  /** Owner only: the "Make primary" action on each other recording. */
  onMakePrimary?: (fileId: string) => void
  /**
   * The recording being made primary, which disables the action everywhere. The
   * activity card says so in one place, so the row itself keeps its label.
   */
  makingPrimaryId: string | null
}> = ({ files, selected, onSelect, onMakePrimary, makingPrimaryId }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        // `shrink` over the button's own `shrink-0`: next to the download
        // button the trigger is what gives, truncating its label, so the two
        // stay on one line on a phone.
        className="h-[30px] min-w-0 max-w-[min(100%,18rem)] shrink gap-1.5 rounded-lg px-2.5 text-sm font-medium"
      >
        <Watch className="size-3.5 text-primary" aria-hidden="true" />
        <span className="truncate">{getRecordingLabel(selected)}</span>
        {/* Muted: the chevron is chrome, not content. */}
        <ChevronDown
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      </Button>
    </DropdownMenuTrigger>
    {/* Chrome shared with `SectionNavSelect` (rounded-xl menu, rounded-lg rows,
        the orange wash on the current one) — the two menus sit within a screen
        of each other on this page and a mismatch reads as a mistake. */}
    <DropdownMenuContent
      align="start"
      sideOffset={6}
      // Keeps the menu off the screen edge on a phone instead of flush to it.
      collisionPadding={16}
      className="w-80 max-w-[calc(100vw-2rem)] rounded-xl shadow-lg"
    >
      <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recordings
      </DropdownMenuLabel>
      {files.map((file) => {
        const isCurrent = file.id === selected.id
        const label = getRecordingLabel(file)
        const summary = getRecordingSummary(file)
        return (
          // `role="none"` wrapper: two sibling menu items, so the row and its
          // action are both reached with the arrow keys. A bare `<button>` in a
          // Radix menu is not — the menu swallows Tab — and nesting one inside
          // the row's item would be a button in a button.
          <div
            key={file.id}
            role="none"
            className={cn(
              'flex items-center gap-1 rounded-lg',
              isCurrent && 'bg-primary/10'
            )}
          >
            <DropdownMenuItem
              onSelect={() => onSelect(file.id)}
              // State-driven menu (nothing navigates), so the boolean form
              // rather than aria-current="page".
              aria-current={isCurrent ? 'true' : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-3 py-2',
                isCurrent && [
                  'text-primary-text focus:bg-primary/10 focus:text-primary-text dark:focus:bg-primary/10',
                  // "Held on focus" would otherwise make the focused current
                  // row identical to its resting state; the ring keeps focus
                  // visible there (WCAG 2.4.7).
                  'focus:ring-2 focus:ring-primary/50'
                ]
              )}
            >
              <Watch
                className={cn(
                  'mt-0.5 size-4',
                  isCurrent ? 'text-primary' : 'text-popover-foreground'
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{label}</span>
                  {file.isPrimary ? (
                    <span className={PRIMARY_PILL}>Primary</span>
                  ) : null}
                </span>
                {summary ? (
                  <span className="block text-xs text-muted-foreground">
                    {summary}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
            {/* Only a finished recording: the server refuses one still being
                processed (or failed), and an action that can only fail is
                better not offered. */}
            {onMakePrimary &&
            !file.isPrimary &&
            file.processingStatus === 'completed' ? (
              <DropdownMenuItem
                disabled={makingPrimaryId !== null}
                onSelect={() => onMakePrimary(file.id)}
                aria-label={`Make primary: ${label}`}
                className="mr-2 shrink-0 rounded-md border px-2 py-1 text-xs font-medium"
              >
                Make primary
              </DropdownMenuItem>
            ) : null}
          </div>
        )
      })}
    </DropdownMenuContent>
  </DropdownMenu>
)

/**
 * The "Recorded with" line of the activity card.
 *
 * - Several recordings of the activity: the device is a picker over all of them
 *   (it replaces the separate "Activity file" card), because which recording the
 *   page describes is what a device name already says.
 * - One recording: today's plain "Recorded with <device>" line.
 * - The owner also gets the selected recording's download beside it. With no
 *   device to name, that button is the whole line (labelled "Original file"),
 *   so an owner can still reach a file the card says nothing about; everyone
 *   else sees nothing.
 */
export const RecordingLine: FC<{
  files: StatusFitnessFileItem[]
  selected: StatusFitnessFileItem | undefined
  isOwner: boolean
  /** Set for the owner only; see `DownloadRecordingButton`. */
  downloadHref?: string
  onSelect: (fileId: string) => void
  onMakePrimary?: (fileId: string) => void
  makingPrimaryId: string | null
}> = ({
  files,
  selected,
  isOwner,
  downloadHref,
  onSelect,
  onMakePrimary,
  makingPrimaryId
}) => {
  if (!selected) return null

  const isPicker = files.length > 1
  const deviceLabel = getRecordingDeviceLabel(selected)
  const download = downloadHref ? (
    <DownloadRecordingButton
      href={downloadHref}
      fileType={selected.fileType}
      label={isPicker || deviceLabel ? undefined : 'Original file'}
    />
  ) : null

  if (!isPicker && !deviceLabel && !download) return null

  if (isPicker) {
    return (
      // Only the words may wrap: the picker and the download button stay one
      // unit on one line, the picker truncating when the row is narrow.
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <span>Recorded with</span>
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <RecordingPicker
            files={files}
            selected={selected}
            onSelect={onSelect}
            onMakePrimary={isOwner ? onMakePrimary : undefined}
            makingPrimaryId={makingPrimaryId}
          />
          {download}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {deviceLabel ? (
        <div className="text-sm text-muted-foreground">
          Recorded with{' '}
          <BrandedDeviceLink
            deviceName={selected.deviceName}
            deviceManufacturer={selected.deviceManufacturer}
            deviceGearId={selected.deviceGearId}
            deviceGearName={selected.deviceGearName}
            isOwner={isOwner}
          />
        </div>
      ) : null}
      {download}
    </div>
  )
}

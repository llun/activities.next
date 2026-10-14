import { Bike, Footprints, type LucideIcon, Watch, Wrench } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { formatGearDistanceKm } from '@/app/(timeline)/fitness/gear/gearUi'
import type { FitnessGearKind } from '@/lib/types/database/fitnessGear'

export interface GearPickerOption {
  id: string
  name: string
  kind: FitnessGearKind | null
  distanceMeters: number | null
}

// `Wrench` is the app's own icon for the Gear section (see the fitness layout's
// sub-nav), so it is the honest fallback when neither the assigned gear nor the
// activity type says which kind this is — a free-form GPX `activityType` that
// `normalizeActivityTypeToSportKey` refuses to guess at, most often.
const GEAR_KIND_ICON: Record<FitnessGearKind, LucideIcon> = {
  bike: Bike,
  shoes: Footprints,
  // Never reached through the picker — devices are filtered out of it — but a
  // gear already assigned is always shown whatever it is, and this map is what
  // renders that value.
  device: Watch
}

/**
 * The assigned gear, inline in the header's metadata line. The design system
 * (`FAGearRow` in `ui_kits/web/FitnessActivity.jsx`) reads the recording
 * metadata as one wrapping line — date · visibility · gear — rather than giving
 * gear a labelled field and a row of its own, and makes the gear a LINK to its
 * own page. Changing the assignment is not here at all: it is "Change gear" in
 * the post's ⋯ menu, the way `FAMoreMenu` has it.
 *
 * `/fitness/gear/<id>` is owner-scoped, so only the owner gets the link — the
 * same constraint `BrandedDeviceLink` resolves the same way on the line below.
 * Everyone else gets the name as plain text, and nobody gets anything when no
 * gear is attributed.
 */
export const ActivityGearMeta: FC<{
  isOwner: boolean
  /** The id of the gear this activity is attributed to, if any. */
  gearId: string | null
  /** The name the status payload carried, for a viewer with no gear list. */
  gearName: string | null
  /**
   * That gear's lifetime distance, when the owner's shed has been loaded. It
   * rides in the `title` rather than on the line, which is already carrying the
   * date and the visibility.
   */
  distanceMeters: number | null
  /** The kind of the assigned gear, else what the activity type implies. */
  kind: FitnessGearKind | null
}> = ({ isOwner, gearId, gearName, distanceMeters, kind }) => {
  const label = gearName?.trim() || null
  if (!label) return null

  const Icon = kind ? GEAR_KIND_ICON[kind] : Wrench
  const title =
    distanceMeters === null
      ? `Gear: ${label}`
      : `Gear: ${label} · ${formatGearDistanceKm(distanceMeters)}`
  // The icon alone carries the meaning visually; spell it out for a screen
  // reader, which otherwise hears a bare product name.
  const content = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Gear: </span>
      <span className="truncate">{label}</span>
    </>
  )

  return (
    <>
      <span aria-hidden="true">·</span>
      {isOwner && gearId ? (
        <Link
          // One link on a detail page rather than one per feed row, but it
          // points at the same dynamic owner-scoped route the device link
          // beside it does, so it opts out of prefetching for the same reason.
          prefetch={false}
          href={`/fitness/gear/${encodeURIComponent(gearId)}`}
          title={title}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {content}
        </Link>
      ) : (
        <span
          className="inline-flex min-w-0 items-center gap-1.5"
          title={title}
        >
          {content}
        </span>
      )}
    </>
  )
}

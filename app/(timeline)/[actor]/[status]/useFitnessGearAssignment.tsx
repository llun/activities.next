'use client'

import { Wrench } from 'lucide-react'
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState
} from 'react'

import { formatGearDistanceKm } from '@/app/(timeline)/fitness/gear/gearUi'
import {
  type StatusFitnessFileItem,
  getFitnessGearList,
  updateFitnessFileGear
} from '@/lib/client'
import type { PostMenuExtraItem } from '@/lib/components/posts/actions/post-menu'
import { getGearKindForActivityType } from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import type { GearPickerOption } from './ActivityGearMeta'

export interface FitnessGearAssignment {
  selectedGearId: string | null
  /** The assigned gear as the owner's shed knows it (undefined for a viewer). */
  assignedGear: GearPickerOption | undefined
  /** The last failed change for the recording on screen. */
  gearErrorMessage: string | null
  /** "Change gear" for the post's ⋯ menu; empty when there is nothing to pick. */
  gearMenuItems: PostMenuExtraItem[]
}

/**
 * The owner's gear for this activity: the shed, the options the picker offers,
 * and the optimistic change with its per-recording error.
 */
export const useFitnessGearAssignment = ({
  isOwner,
  fitness,
  setFitnessFiles
}: {
  isOwner: boolean
  fitness: StatusFitnessFileItem | undefined
  setFitnessFiles: Dispatch<SetStateAction<StatusFitnessFileItem[]>>
}): FitnessGearAssignment => {
  const [gearOptions, setGearOptions] = useState<GearEntity[]>([])
  // Keyed by file, not a single slot. An activity can aggregate several files
  // and the switcher stays enabled during a PATCH, so a failure that lands after
  // the reader has moved on must not render as the NEXT file's error — that
  // would wire `aria-describedby` from that file's picker to a message about a
  // different one. One slot was not enough either: whichever file failed second
  // would evict the first, and the first was invisible at the time precisely
  // because its reader had moved on, so nobody would ever have seen it.
  const [gearUpdateErrors, setGearUpdateErrors] = useState<
    Record<string, string>
  >({})
  const [isSavingGear, setIsSavingGear] = useState(false)
  // Owner only — /api/v1/fitness/gear is the owner's shed, and a viewer has no
  // use for it. A failure leaves the list empty, which degrades the picker to
  // the read-only gear row rather than breaking the page.
  useEffect(() => {
    if (!isOwner) return

    let cancelled = false

    const loadGear = async () => {
      try {
        const gear = await getFitnessGearList()
        if (cancelled) return
        setGearOptions(gear)
      } catch {
        // Keep the read-only presentation when the gear list is unavailable.
      }
    }

    void loadGear()

    return () => {
      cancelled = true
    }
  }, [isOwner])

  const selectedGearId = fitness?.gearId ?? null
  // Options for the owner's gear picker. Retired gear is out (it is still
  // *assignable* through the API — see `setFitnessFileGear` — but it does not
  // belong in a picker for a fresh activity), and the list narrows to the kind
  // the activity implies. An unrecognised activity type narrows to nothing:
  // `getGearKindForActivityType` is a convenience, never a permission.
  //
  // Whatever is currently assigned is ALWAYS in the list, even when the kind
  // filter or its retirement would drop it — a picker that cannot represent its
  // own value renders the assignment as something else, which reads as the gear
  // having changed on its own. The last fallback covers the gear list failing to
  // load at all, using the name the status payload carried.
  const gearPickerOptions = useMemo<GearPickerOption[]>(() => {
    const kind = getGearKindForActivityType(fitness?.activityType)
    // Devices are excluded BEFORE the kind narrowing, not by it: an
    // unrecognised activity type narrows to nothing and offers every active
    // gear, which would put the head unit that recorded the ride in the list of
    // things the ride could have been done on.
    const active = gearOptions.filter(
      (gear) => gear.retiredAt === null && gear.kind !== 'device'
    )
    const options = (
      kind ? active.filter((gear) => gear.kind === kind) : active
    ).map((gear) => ({
      id: gear.id,
      name: gear.name,
      kind: gear.kind,
      distanceMeters: gear.distanceMeters
    }))

    if (!selectedGearId || options.some((item) => item.id === selectedGearId)) {
      return options
    }

    const assigned = gearOptions.find((gear) => gear.id === selectedGearId)
    return [
      {
        id: selectedGearId,
        name: assigned?.name ?? fitness?.gearName ?? 'Assigned gear',
        kind: assigned?.kind ?? null,
        distanceMeters: assigned?.distanceMeters ?? null
      },
      ...options
    ]
  }, [gearOptions, fitness?.activityType, fitness?.gearName, selectedGearId])

  // Whatever is assigned is always in `gearPickerOptions` when the shed has
  // loaded, so this is where the metadata line's link gets its kind icon and
  // its lifetime distance. Undefined for a viewer (who never loads the shed)
  // and for an owner whose shed failed to load, both of which fall back to the
  // activity type's kind and no distance.
  const assignedGear = selectedGearId
    ? gearPickerOptions.find((option) => option.id === selectedGearId)
    : undefined

  // Only ever the error for the file on screen; a failure that lands after the
  // reader switched files stays with the file it happened to, and comes back
  // with it.
  const gearErrorMessage = fitness?.id
    ? (gearUpdateErrors[fitness.id] ?? null)
    : null

  const handleGearChange = async (value: string) => {
    const fitnessFileId = fitness?.id
    if (!fitnessFileId) return
    // Re-picking what is already assigned is not a change. A `<select>` never
    // fired `onChange` for that, but every row of a menu fires `onSelect`, and
    // tapping the checked row to dismiss the menu is the natural gesture — it
    // would otherwise PATCH, re-evaluate the service reminders, and on a network
    // hiccup show an error for a change the owner never made.
    if (value === (selectedGearId ?? '')) return

    const nextGearId = value || null
    const nextGearName = nextGearId
      ? (gearPickerOptions.find((item) => item.id === nextGearId)?.name ?? null)
      : null
    // Only this file's assignment is rolled back, and only through an updater:
    // restoring a whole array captured from this render would also discard
    // anything the `getFitnessFilesByStatus` effect (or a sibling file's own
    // change) wrote while the PATCH was in flight.
    const previousGearId = fitness?.gearId ?? null
    const previousGearName = fitness?.gearName ?? null

    // Drops only this file's own error. A reset that reached the whole map
    // would discard a sibling file's pending failure, and because that one was
    // hidden while its reader was on another file, they would never have seen
    // it — the gear silently back to what it was, with nothing saying why.
    setGearUpdateErrors((current) => {
      if (!(fitnessFileId in current)) return current
      const { [fitnessFileId]: _cleared, ...rest } = current
      return rest
    })
    setIsSavingGear(true)
    setFitnessFiles((files) =>
      files.map((file) =>
        file.id === fitnessFileId
          ? { ...file, gearId: nextGearId, gearName: nextGearName }
          : file
      )
    )

    try {
      await updateFitnessFileGear(fitnessFileId, nextGearId)
    } catch (error) {
      // Put the previous assignment back rather than leaving the select showing
      // a value the server never accepted.
      setFitnessFiles((files) =>
        files.map((file) =>
          file.id === fitnessFileId
            ? { ...file, gearId: previousGearId, gearName: previousGearName }
            : file
        )
      )
      setGearUpdateErrors((current) => ({
        ...current,
        [fitnessFileId]:
          error instanceof Error ? error.message : 'Failed to update gear.'
      }))
    } finally {
      setIsSavingGear(false)
    }
  }

  // Changing the assignment is an item in the post's own ⋯ menu, the way the
  // design system's `FAMoreMenu` has it — the metadata line's gear is a link to
  // the gear page, not a control. Absent entirely when there is nothing to pick
  // (`FAMoreMenu`'s own `if (!canChange) return null`): a submenu whose only
  // entry is "No gear" is dead UI, the same rule that kept the old picker off
  // an empty shed.
  //
  // Not memoized on purpose: it closes over `handleGearChange`, which is rebuilt
  // every render anyway, so a `useMemo` here would only be able to hand back a
  // stale one.
  const gearMenuItems: PostMenuExtraItem[] =
    isOwner && gearPickerOptions.length > 0
      ? [
          {
            key: 'change-gear',
            icon: <Wrench className="size-4" />,
            label: 'Change gear',
            // Two quick changes otherwise race, and the loser's rollback would
            // put back a value the server has since replaced. On the trigger as
            // well as the rows, so the submenu cannot even be opened mid-write.
            disabled: isSavingGear,
            items: [
              ...gearPickerOptions.map((option) => ({
                key: option.id,
                label: option.name,
                checked: option.id === selectedGearId,
                // The lifetime total, as the design shows it — it is what tells
                // two similar bikes apart at a glance. Absent on a gear the
                // list never returned.
                trailing:
                  typeof option.distanceMeters === 'number'
                    ? formatGearDistanceKm(option.distanceMeters)
                    : undefined,
                disabled: isSavingGear,
                onSelect: () => void handleGearChange(option.id)
              })),
              {
                key: 'no-gear',
                label: 'No gear',
                checked: selectedGearId === null,
                muted: true,
                disabled: isSavingGear,
                onSelect: () => void handleGearChange('')
              }
            ]
          }
        ]
      : []

  return { selectedGearId, assignedGear, gearErrorMessage, gearMenuItems }
}

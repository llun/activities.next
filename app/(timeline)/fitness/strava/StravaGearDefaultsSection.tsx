'use client'

import { Bike, Footprints, X } from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useState } from 'react'

import {
  formatGearDistanceKm,
  getGearDisplayName
} from '@/app/(timeline)/fitness/gear/gearUi'
import { getFitnessGearList, updateFitnessGear } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import {
  type FitnessGearKind,
  SPORT_KEYS,
  SPORT_KIND,
  type SportKey,
  getSportLabel
} from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

const KIND_ICON: Record<FitnessGearKind, typeof Bike> = {
  bike: Bike,
  shoes: Footprints
}

const KIND_GROUP_LABEL: Record<FitnessGearKind, string> = {
  bike: 'Cycling',
  shoes: 'Running & walking'
}

const KIND_ORDER: FitnessGearKind[] = ['bike', 'shoes']

interface DefaultRow {
  sportKey: SportKey
  gear: GearEntity
}

/**
 * The sport → gear mapping, read back out of the gear rows that hold it.
 *
 * There is no separate mapping table: `fitness_gears.defaultSports` IS the
 * mapping, and the database enforces that a sport belongs to at most one of an
 * actor's gears. Rows are emitted in `SPORT_KEYS` order so the list does not
 * reshuffle when a save returns the gears in a different order.
 */
export const getDefaultRows = (gears: GearEntity[]): DefaultRow[] => {
  const gearBySport = new Map<SportKey, GearEntity>()
  for (const gear of gears) {
    for (const sport of gear.defaultSports) {
      // A gear could name a sport this build does not know (an older row, a
      // future key); it simply has no row to render.
      if (!gearBySport.has(sport as SportKey)) {
        gearBySport.set(sport as SportKey, gear)
      }
    }
  }

  return SPORT_KEYS.flatMap((sportKey) => {
    const gear = gearBySport.get(sportKey)
    return gear ? [{ sportKey, gear }] : []
  })
}

/**
 * The gears offerable for a sport: the active ones of its kind, plus whatever
 * is currently assigned even when the kind filter or its retirement would drop
 * it. A picker that cannot represent its own value renders the assignment as
 * something else, which reads as the mapping having changed on its own.
 */
export const getGearOptionsForSport = (
  gears: GearEntity[],
  sportKey: SportKey,
  assignedGearId?: string
): GearEntity[] => {
  const kind = SPORT_KIND[sportKey]
  const options = gears.filter((gear) => gear.kind === kind && !gear.retiredAt)
  if (
    assignedGearId &&
    !options.some((option) => option.id === assignedGearId)
  ) {
    const assigned = gears.find((gear) => gear.id === assignedGearId)
    if (assigned) return [assigned, ...options]
  }
  return options
}

const getOptionLabel = (gear: GearEntity): string => {
  const name = getGearDisplayName(gear)
  const distance = formatGearDistanceKm(gear.distanceMeters)
  // The lifetime distance is what tells two similar bikes apart at a glance.
  return gear.retiredAt
    ? `${name} · ${distance} (retired)`
    : `${name} · ${distance}`
}

export const StravaGearDefaultsSection: FC = () => {
  const [gears, setGears] = useState<GearEntity[] | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let isActive = true

    const loadGears = async () => {
      try {
        const list = await getFitnessGearList()
        if (isActive) setGears(list)
      } catch (_error) {
        if (isActive) {
          setGears([])
          setError('Failed to load gear.')
        }
      }
    }

    void loadGears()

    return () => {
      isActive = false
    }
  }, [])

  // Every write goes through here. Adding a sport to a gear takes it off
  // whoever held it — the database does that inside the same transaction — so
  // the whole list is re-read rather than patched locally: the response only
  // carries the gear that was written, not the one it was taken from.
  const saveDefaultSports = async (gearId: string, sports: string[]) => {
    setError('')
    setIsSaving(true)
    try {
      await updateFitnessGear(gearId, { defaultSports: sports })
      setGears(await getFitnessGearList())
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save default gear.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const assignSport = (gear: GearEntity, sportKey: SportKey) =>
    saveDefaultSports(gear.id, [
      ...gear.defaultSports.filter((sport) => sport !== sportKey),
      sportKey
    ])

  const clearSport = (gear: GearEntity, sportKey: SportKey) =>
    saveDefaultSports(
      gear.id,
      gear.defaultSports.filter((sport) => sport !== sportKey)
    )

  const rows = gears ? getDefaultRows(gears) : []
  const mappedSports = new Set(rows.map((row) => row.sportKey))
  const activeGears = (gears ?? []).filter((gear) => !gear.retiredAt)
  const addableSportsByKind = KIND_ORDER.map((kind) => ({
    kind,
    // A sport is only addable when there is a gear of its kind to point it at.
    sports: activeGears.some((gear) => gear.kind === kind)
      ? SPORT_KEYS.filter(
          (sportKey) =>
            SPORT_KIND[sportKey] === kind && !mappedSports.has(sportKey)
        )
      : []
  })).filter(({ sports }) => sports.length > 0)

  const handleAdd = (value: string) => {
    if (!gears) return
    const sportKey = SPORT_KEYS.find((key) => key === value)
    if (!sportKey) return

    const gear = activeGears.find(
      (candidate) => candidate.kind === SPORT_KIND[sportKey]
    )
    if (!gear) return

    void assignSport(gear, sportKey)
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Default gear</h2>
        <p className="text-sm text-muted-foreground">
          Gear assigned to imported activities, by activity type.
        </p>
      </div>

      {gears === null && (
        <p className="text-sm text-muted-foreground">Loading gear…</p>
      )}

      {gears !== null && gears.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No gear yet.{' '}
          <Link href="/fitness/gear" className="underline">
            Add a bike or a pair of shoes
          </Link>{' '}
          to assign it to imported activities.
        </div>
      )}

      {gears !== null && gears.length > 0 && rows.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No defaults yet — add an activity type below.
        </div>
      )}

      {rows.map(({ sportKey, gear }) => {
        const KindIcon = KIND_ICON[SPORT_KIND[sportKey]]
        const options = getGearOptionsForSport(gears ?? [], sportKey, gear.id)
        const selectId = `gear-default-${sportKey}`
        return (
          // The picker and its remove button share a wrapper that is `w-full`
          // below `sm`, so they wrap onto their own line and leave the whole
          // first line to the activity type. Inline, a fixed-width picker beside
          // a `flex-1` label eats the row on a phone and truncates "Trail run"
          // down to "T".
          <div
            key={sportKey}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3"
          >
            <KindIcon className="size-4 shrink-0 text-muted-foreground" />
            <Label
              htmlFor={selectId}
              className="min-w-0 flex-1 truncate text-sm font-medium"
            >
              {getSportLabel(sportKey)}
            </Label>
            <div className="flex w-full items-center gap-1 sm:w-auto">
              <Select
                id={selectId}
                className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                value={gear.id}
                disabled={isSaving}
                onChange={(event) => {
                  const nextGear = (gears ?? []).find(
                    (candidate) => candidate.id === event.target.value
                  )
                  if (nextGear) void assignSport(nextGear, sportKey)
                }}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {getOptionLabel(option)}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={`Remove ${getSportLabel(sportKey)}`}
                disabled={isSaving}
                onClick={() => void clearSport(gear, sportKey)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        )
      })}

      {addableSportsByKind.length > 0 && (
        <Select
          aria-label="Add activity type"
          className="w-52"
          value=""
          disabled={isSaving}
          onChange={(event) => handleAdd(event.target.value)}
        >
          <option value="">Add activity type…</option>
          {addableSportsByKind.map(({ kind, sports }) => (
            <optgroup key={kind} label={KIND_GROUP_LABEL[kind]}>
              {sports.map((sportKey) => (
                <option key={sportKey} value={sportKey}>
                  {getSportLabel(sportKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        These are the same default sports each gear carries — one gear per
        activity type, so picking a gear here moves the type off whichever gear
        held it. Changing a default only affects activities imported afterwards,
        never recorded history.
      </p>
    </section>
  )
}

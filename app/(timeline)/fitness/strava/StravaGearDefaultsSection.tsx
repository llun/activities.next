'use client'

import { Bike, Check, ChevronDown, Footprints, X } from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useRef, useState } from 'react'

import {
  formatGearDistanceKm,
  getGearDisplayName
} from '@/app/(timeline)/fitness/gear/gearUi'
import { getFitnessGearList, updateFitnessGear } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import {
  type FitnessGearKind,
  SPORT_KEYS,
  SPORT_KIND,
  type SportKey,
  getSportLabel
} from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { cn } from '@/lib/utils'

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

const ERROR_ID = 'gear-defaults-error'

export const StravaGearDefaultsSection: FC = () => {
  // `null` means "not answered yet" and is deliberately NOT collapsed to an
  // empty array on failure: the empty states below key on `gears.length`, so a
  // transient 500 would otherwise tell an actor with a full shed that they have
  // no gear and should go add some.
  const [gears, setGears] = useState<GearEntity[] | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  // Where focus should go once the write settles, resolved AFTER the re-render
  // rather than captured before it — the control that started the write is not
  // always still there (removing the last mapped sport unmounts its row;
  // adding the last addable one unmounts the add menu), so each caller gives a
  // preference order and the first connected node wins.
  //
  // This exists because Radix restores focus to the trigger in
  // `onCloseAutoFocus`, but `setIsSaving(true)` lands first (`onSelect` runs
  // inside a `flushSync`), so it restores onto a disabled button and the
  // browser drops focus to `<body>` — a keyboard user would Tab from the top of
  // the document again after every single change.
  const pendingFocusRef = useRef<(() => HTMLButtonElement | null) | null>(null)
  // Each row's picker, by sport. Bounded by `SPORT_KEYS`, and React calls the
  // ref callback with `null` on unmount, so entries go stale-as-null rather
  // than holding detached nodes.
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const addTriggerRef = useRef<HTMLButtonElement | null>(null)

  const firstRowTrigger = () => {
    for (const trigger of triggerRefs.current.values()) {
      if (trigger?.isConnected) return trigger
    }
    return null
  }

  const loadGears = async () => {
    setError('')
    try {
      setGears(await getFitnessGearList())
    } catch (_error) {
      setError('Failed to load gear.')
    }
  }

  useEffect(() => {
    let isActive = true

    const loadOnMount = async () => {
      try {
        const list = await getFitnessGearList()
        if (isActive) setGears(list)
      } catch (_error) {
        if (isActive) setError('Failed to load gear.')
      }
    }

    void loadOnMount()

    return () => {
      isActive = false
    }
  }, [])

  // Runs after the re-render that re-enables the controls, which is the only
  // point at which a trigger can take focus again.
  useEffect(() => {
    if (isSaving) return
    const resolveTarget = pendingFocusRef.current
    if (!resolveTarget) return
    pendingFocusRef.current = null

    // Only restore focus that was actually DROPPED. The reader may have moved
    // on during the write — the section disables itself but the Strava
    // credential form above it does not, so yanking focus back would pull them
    // out of a field they had started typing in.
    const active = document.activeElement
    if (active && active !== document.body) return

    const target = resolveTarget()
    if (target?.isConnected) target.focus()
  }, [isSaving, gears])

  // Every write goes through here. Adding a sport to a gear takes it off
  // whoever held it — the database does that inside the same transaction — so
  // the whole list is re-read rather than patched locally: the response only
  // carries the gear that was written, not the one it was taken from.
  const saveDefaultSports = async (
    gearId: string,
    sports: string[],
    resolveFocusTarget: () => HTMLButtonElement | null
  ) => {
    setError('')
    pendingFocusRef.current = resolveFocusTarget
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
    saveDefaultSports(
      gear.id,
      [...gear.defaultSports.filter((sport) => sport !== sportKey), sportKey],
      // The sport's own row, which either already existed or has just been
      // created by this write — and is the thing that changed, so it is where
      // a reader wants to land either way.
      () => triggerRefs.current.get(sportKey) ?? addTriggerRef.current
    )

  const clearSport = (gear: GearEntity, sportKey: SportKey) =>
    saveDefaultSports(
      gear.id,
      gear.defaultSports.filter((sport) => sport !== sportKey),
      // On success this row is gone, so focus goes to the add menu — which the
      // removal itself has just put the sport back into. On failure the row is
      // still there and its own picker is the closest thing to where the
      // reader was.
      () =>
        triggerRefs.current.get(sportKey)?.isConnected
          ? (triggerRefs.current.get(sportKey) ?? null)
          : (addTriggerRef.current ?? firstRowTrigger())
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

      {gears === null && !error && (
        <p className="text-sm text-muted-foreground">Loading gear…</p>
      )}

      {/* A failed initial load renders no rows and no add control, so the only
          thing that clears the error — a successful write — is unreachable.
          Without this the section is a dead end until the page is reloaded. */}
      {gears === null && error && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadGears()}
        >
          Try again
        </Button>
      )}

      {/* Three empty states, not two. "Add an activity type below" is only
          honest when there is something below to add with, and the add control
          needs an ACTIVE gear to point a type at — so an actor whose only gear
          is retired would otherwise be told to use a control that is not
          there. Reachable in two steps: retire your only bike, then remove its
          row. */}
      {gears !== null && rows.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {gears.length === 0 ? (
            <>
              No gear yet.{' '}
              <Link href="/fitness/gear" className="underline">
                Add a bike or a pair of shoes
              </Link>{' '}
              to assign it to imported activities.
            </>
          ) : addableSportsByKind.length > 0 ? (
            'No defaults yet — add an activity type below.'
          ) : (
            <>
              No defaults yet. Every gear you have is retired, and retired gear
              is not assigned to new activities —{' '}
              <Link href="/fitness/gear" className="underline">
                unretire one or add another
              </Link>{' '}
              to set a default.
            </>
          )}
        </div>
      )}

      {rows.map(({ sportKey, gear }) => {
        const KindIcon = KIND_ICON[SPORT_KIND[sportKey]]
        const options = getGearOptionsForSport(gears ?? [], sportKey, gear.id)
        const sportLabel = getSportLabel(sportKey)
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
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {sportLabel}
            </span>
            <div className="flex w-full items-center gap-1 sm:w-auto">
              {/* A menu rather than a `<select>`, the same way the activity
                  page's gear picker is (`FitnessStatusDetail`'s
                  `ActivityGearMeta`). Both commit the moment they change, and
                  on Windows/Linux an arrow key on a CLOSED `<select>` moves the
                  selection and fires `change` per keystroke — so navigating to
                  the third bike would PATCH the second one on the way past,
                  taking the sport off its current holder. A menu commits only
                  on Enter or click, so that class of stray write is gone.

                  It does NOT fix the other half on its own. `onSelect` runs
                  inside Radix's `flushSync`, so `setIsSaving(true)` lands
                  before the menu closes and Radix's own focus restore then
                  targets a disabled button, dropping focus to `<body>`. The
                  trigger is captured here and refocused once the write settles;
                  see `pendingFocusRef`. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={isSaving}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    aria-describedby={error ? ERROR_ID : undefined}
                    ref={(element) => {
                      triggerRefs.current.set(sportKey, element)
                    }}
                    className="min-w-0 flex-1 justify-between font-normal sm:w-56 sm:flex-none"
                  >
                    {/* Named from its content, so the accessible name carries
                        the value too — "Ride: Moots · 42.6 km", not a bare
                        "Ride" that says nothing about what is assigned. */}
                    <span className="sr-only">{sportLabel}: </span>
                    <span className="truncate">{getOptionLabel(gear)}</span>
                    <ChevronDown
                      className="size-3.5 shrink-0 opacity-50"
                      aria-hidden="true"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="rounded-xl shadow-lg"
                >
                  {options.map((option) => {
                    const isActive = option.id === gear.id
                    return (
                      <DropdownMenuItem
                        key={option.id}
                        // Picking what is already assigned is not a change. A
                        // `<select>` never fired `change` for that; every menu
                        // row fires `onSelect`, and tapping the checked row to
                        // dismiss the menu is the natural gesture.
                        onSelect={() => {
                          if (isActive) return
                          void assignSport(option, sportKey)
                        }}
                        // One-of-N, so radio semantics rather than the
                        // `aria-current` the navigation dropdowns use. The
                        // check mark is decorative, so `aria-checked` is the
                        // only thing announcing which gear is assigned.
                        role="menuitemradio"
                        aria-checked={isActive}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 font-medium',
                          isActive && [
                            'bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary',
                            'focus:ring-2 focus:ring-primary/50'
                          ]
                        )}
                      >
                        <Check
                          className={cn(
                            'size-4 shrink-0',
                            !isActive && 'invisible'
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {getGearDisplayName(option)}
                          {option.retiredAt ? ' (retired)' : ''}
                        </span>
                        <span className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">
                          {formatGearDistanceKm(option.distanceMeters)}
                        </span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={`Remove ${sportLabel}`}
                aria-describedby={error ? ERROR_ID : undefined}
                disabled={isSaving}
                onClick={() => void clearSport(gear, sportKey)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        )
      })}

      {/* A menu here for the same reason as the row pickers: this control also
          commits on pick, so an arrow key on a closed `<select>` would add an
          activity type the user was only scrolling past. */}
      {addableSportsByKind.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isSaving}>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              aria-describedby={error ? ERROR_ID : undefined}
              ref={addTriggerRef}
              className="w-full justify-between font-normal sm:w-52"
            >
              Add activity type…
              <ChevronDown
                className="size-3.5 shrink-0 opacity-50"
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-xl shadow-lg">
            {addableSportsByKind.map(({ kind, sports }, groupIndex) => (
              <DropdownMenuGroup
                key={kind}
                // Radix's `MenuGroup` is a bare `role="group"` and its `Label`
                // a bare div, so without this the group has no accessible name
                // and the heading text is skipped entirely in a screen
                // reader's menu mode — a regression from the `<optgroup
                // label>` this replaced, which was announced.
                aria-labelledby={`gear-defaults-add-${kind}`}
              >
                {groupIndex > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel
                  id={`gear-defaults-add-${kind}`}
                  className="text-xs text-muted-foreground"
                >
                  {KIND_GROUP_LABEL[kind]}
                </DropdownMenuLabel>
                {sports.map((sportKey) => (
                  <DropdownMenuItem
                    key={sportKey}
                    className="rounded-lg px-3 py-2 font-medium"
                    onSelect={() => handleAdd(sportKey)}
                  >
                    {getSportLabel(sportKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* `role="alert"` because a failed write is otherwise silent: the menu
          has closed, the trigger still reads the old gear, and the only sign
          is text appended at the bottom of the section. Every control that can
          cause it — both pickers and each row's remove button — points at it
          with `aria-describedby`, so the failure is reachable from whichever
          one the reader used, the way the activity page's picker does. */}
      {error && (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        These are the same default sports each gear carries — one gear per
        activity type, so picking a gear here moves the type off whichever gear
        held it. Changing a default only affects activities imported afterwards,
        never recorded history.
      </p>
    </section>
  )
}

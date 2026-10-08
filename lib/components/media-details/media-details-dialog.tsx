'use client'

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Play,
  Sparkles,
  X
} from 'lucide-react'
import Link from 'next/link'
import {
  FC,
  KeyboardEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  SubjectSuggestionsEntity,
  createGalleryGear,
  describeMedia,
  getGalleryGears,
  getMedia,
  retryMediaLookups,
  suggestMediaSubjects,
  updateMediaDetails
} from '@/lib/client'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import type {
  GalleryGearEntity,
  GallerySettingsEntity
} from '@/lib/services/gallery/galleryEntities'
import { MAX_MEDIA_DESCRIPTION_LENGTH } from '@/lib/services/medias/constants'
import {
  STALE_PLACE_LOOKUP_MS,
  STALE_SUBJECT_LOOKUP_MS
} from '@/lib/services/medias/lookupStaleness'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import {
  IucnCategory,
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES,
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import {
  MediaDetailsDraft,
  PickedSubject,
  SharedSections,
  applySharedSections,
  diffDraft,
  draftFromDetails,
  effectiveDescription,
  subjectPatch
} from './mediaDetailsDraft'
import { SpeciesPickerDialog } from './species-picker-dialog'
import { SubjectSuggestions, TaxonPathLine } from './subject-suggestions'
import { capitalize } from './subjectChoices'

export interface MediaDetailsDialogItem {
  id: string
  mediaType: string
  url: string
  posterUrl?: string
  width: number
  height: number
  /** The description (alt text) the composer holds for the item. */
  description: string
  decorative: boolean
  /** Owner details from `GET /api/v1/media/:id`; null when not loaded. */
  details: MediaDetailsEntity | null
}

export interface MediaDetailsSavedItem {
  id: string
  description: string
  decorative: boolean
  /** Fresh details from the server; absent when nothing was sent. */
  details?: MediaDetailsEntity
}

interface Props {
  items: MediaDetailsDialogItem[]
  initialId: string
  settings: GallerySettingsEntity | null
  onClose: () => void
  onSaved: (items: MediaDetailsSavedItem[]) => void
  /**
   * Owner details the dialog fetched without saving (subject suggestions, a
   * lookup retry), so the composer's tile and a reopened dialog agree. `patch`
   * holds only what this fetch is authoritative for, to be merged into the
   * composer's LATEST details (a slow suggestion must not put back the
   * statuses a retry replaced meanwhile); `details` is the whole entity, for
   * a composer that holds none for the item yet.
   */
  onDetailsRefreshed?: (
    id: string,
    patch: Partial<MediaDetailsEntity>,
    details: MediaDetailsEntity
  ) => void
  /** Ids whose suggestions the composer is still fetching. */
  suggestionsPending?: Record<string, true>
}

const ADD_NEW_GEAR = '__add_new_gear__'

const NO_SUBJECT: PickedSubject = {
  name: '',
  scientificName: '',
  category: '',
  taxonKey: '',
  taxonPath: []
}

const PRECISION_LABELS: Record<MediaPlacePrecision, string> = {
  hidden: 'Hidden',
  country: 'Country',
  area: 'Area · 5 km',
  exact: 'Exact'
}

const isVideo = (item: Pick<MediaDetailsDialogItem, 'mediaType'>) =>
  item.mediaType.startsWith('video')

const formatTakenAt = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  // EXIF stores the camera's wall-clock time without a zone, so show it as
  // stored rather than shifting it into the viewer's zone.
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date)
}

const EMPTY_DETAILS: MediaDetailsEntity = {
  subject: null,
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  inGallery: false,
  subjectSuggestions: null
}

type FetchedDetails = Record<
  string,
  { base: MediaDetailsEntity | null; value: MediaDetailsEntity }
>

/**
 * The details the dialog fetched itself (suggestions, a lookup retry) win over
 * the composer's, until the composer hands over newer ones.
 */
const resolveDetails = (
  entry: MediaDetailsDialogItem,
  fetched: FetchedDetails
): MediaDetailsEntity | null => {
  const own = fetched[entry.id]
  return own && own.base === entry.details ? own.value : entry.details
}

const mergeDetails = (
  base: MediaDetailsEntity | null,
  patch: Partial<MediaDetailsEntity>
): MediaDetailsEntity => ({ ...(base ?? EMPTY_DETAILS), ...patch })

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const IUCN_LABELS: Record<IucnCategory, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
  NE: 'Not Evaluated',
  EW: 'Extinct in the Wild',
  EX: 'Extinct'
}

const Section: FC<{
  title: string
  aside?: ReactNode
  children: ReactNode
}> = ({ title, aside, children }) => (
  <section className="space-y-3 border-b px-5 py-4 last:border-b-0">
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
)

const Field: FC<{ label: string; htmlFor: string; children: ReactNode }> = ({
  label,
  htmlFor,
  children
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
      {label}
    </Label>
    {children}
  </div>
)

const CheckRow: FC<{
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}> = ({ id, checked, disabled, onChange, children }) => (
  <div className="flex items-center gap-2">
    <Checkbox
      id={id}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <Label htmlFor={id} className="text-sm font-normal">
      {children}
    </Label>
  </div>
)

const RetryLink: FC<{
  busy: boolean
  disabled?: boolean
  onRetry: () => void
}> = ({ busy, disabled = false, onRetry }) => (
  <Button
    type="button"
    variant="link"
    size="sm"
    disabled={busy || disabled}
    onClick={onRetry}
    className="h-auto p-0 text-xs"
  >
    {busy ? <Loader2 className="animate-spin" /> : null}
    Retry
  </Button>
)

/**
 * Owner-only state of the subject's IUCN check. The category itself is never
 * public; it only drives whether other people see the photo's place, so every
 * state that keeps the place hidden says so.
 */
const SubjectLookupStatus: FC<{
  subject: NonNullable<MediaDetailsEntity['subject']>
  hidePlaces: boolean
  /** Whether a retry can succeed: species lookups are on for this server. */
  canRetry: boolean
  retrying: boolean
  disabled: boolean
  error: string | null
  onRetry: () => void
}> = ({
  subject,
  hidePlaces,
  canRetry,
  retrying,
  disabled,
  error,
  onRetry
}) => {
  const retry = canRetry ? (
    <>
      {' · '}
      <RetryLink busy={retrying} disabled={disabled} onRetry={onRetry} />
    </>
  ) : null
  // Pending, failed, disabled or never checked: the fail-closed rule keeps
  // the place from everyone else meanwhile.
  const hiddenNote =
    hidePlaces && subject.threatStatus === 'unchecked' ? (
      <span className="block">
        The place stays hidden from other people until it’s checked.
      </span>
    ) : null

  let content: ReactNode = null
  if (subject.lookupStatus === 'pending') {
    content = (
      <>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span role="status">Checking IUCN status…</span>
          {subject.lookupStale ? retry : null}
        </span>
        {hiddenNote}
      </>
    )
  } else if (
    subject.lookupStatus === 'resolved' &&
    subject.iucnCategory !== null
  ) {
    content = (
      <>
        <span>
          {IUCN_LABELS[subject.iucnCategory]} ({subject.iucnCategory}) · IUCN
          Red List status via GBIF
        </span>
        {subject.threatStatus === 'threatened' && hidePlaces ? (
          <span className="block">
            Threatened: the place is hidden from other people.
          </span>
        ) : null}
      </>
    )
  } else if (subject.lookupStatus === 'no-match') {
    content = <span>Not found in the GBIF taxonomy, so no IUCN status.</span>
  } else if (subject.threatStatus === 'unchecked') {
    // `failed`, `disabled`, a resolved row with no category, or a species-like
    // subject that was never checked (null).
    content = (
      <>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          Couldn’t check IUCN status
          {retry}
        </span>
        {hiddenNote}
      </>
    )
  }
  if (!content && !error) return null
  return (
    <div className="text-xs text-muted-foreground">
      {content}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const PlaceLookupStatus: FC<{
  place: NonNullable<MediaDetailsEntity['place']> | null
  /** Whether a retry can succeed: place lookups are on for this server. */
  canRetry: boolean
  retrying: boolean
  disabled: boolean
  error: string | null
  onRetry: () => void
}> = ({ place, canRetry, retrying, disabled, error, onRetry }) => {
  const retry = canRetry ? (
    <>
      {' · '}
      <RetryLink busy={retrying} disabled={disabled} onRetry={onRetry} />
    </>
  ) : null
  const hasCoordinates =
    place !== null && place.latitude !== null && place.longitude !== null

  let content: ReactNode = null
  if (place?.lookupStatus === 'pending') {
    // Queued or running. Retry only once it has taken too long: a job lost to
    // a queue outage would otherwise leave this up for good.
    content = (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span role="status">Looking up the place name…</span>
        {place.lookupStale ? retry : null}
      </span>
    )
  } else if (
    canRetry &&
    (place?.lookupStatus === 'failed' ||
      (hasCoordinates && place?.lookupStatus === 'disabled'))
  ) {
    content = (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        Couldn’t look up the place name{retry}
      </span>
    )
  } else if (canRetry && hasCoordinates && place?.lookupStatus === null) {
    // Coordinates whose lookup was never queued: saved before lookups
    // existed. (A point set or moved since is `pending` until its job runs.)
    content = (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        The place name hasn’t been looked up{retry}
      </span>
    )
  }
  if (!content && !error) return null
  return (
    <div className="text-xs text-muted-foreground">
      {content}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// While a lookup is under way the dialog reads the media again, a few times
// and a few seconds apart: the composer's copy is the one the upload or save
// answered with, from before the job ran. Each pending state (a new upload, a
// Retry: each stamps a new lookup time) gets its own budget of reads.
const LOOKUP_REFRESH_ATTEMPTS = 4
const LOOKUP_REFRESH_DELAY_MS = 3_000

const isLookupUnderWay = (details: MediaDetailsEntity | null) =>
  (details?.place?.lookupStatus === 'pending' && !details.place.lookupStale) ||
  (details?.subject?.lookupStatus === 'pending' && !details.subject.lookupStale)

type LookupKind = 'subject' | 'place'
const STALE_LOOKUP_MS: Record<LookupKind, number> = {
  subject: STALE_SUBJECT_LOOKUP_MS,
  place: STALE_PLACE_LOOKUP_MS
}

// When a pending, not yet stale lookup of `kind` turns stale (epoch ms), or
// null. No lookup time means the server already decided.
const staleTimeOf = (
  details: MediaDetailsEntity | null,
  kind: LookupKind
): number | null => {
  const lookup = details?.[kind]
  if (lookup?.lookupStatus !== 'pending' || lookup.lookupStale) return null
  const at = lookup.lookupAt ? Date.parse(lookup.lookupAt) : NaN
  return Number.isNaN(at) ? null : at + STALE_LOOKUP_MS[kind]
}

// The pending state the budget of reads belongs to.
const pendingStateKey = (details: MediaDetailsEntity | null) =>
  (['subject', 'place'] as const)
    .map((kind) =>
      details?.[kind]?.lookupStatus === 'pending'
        ? `${kind}@${details[kind]?.lookupAt ?? ''}`
        : ''
    )
    .join('|')

/**
 * The lookups that have been pending for longer than they should, marked
 * stale as the server would mark them on its next read, so Retry shows in a
 * dialog that has stopped reading. Unchanged when none are.
 */
const withClientStaleness = (
  details: MediaDetailsEntity,
  now: number
): MediaDetailsEntity => {
  let next = details
  for (const kind of ['subject', 'place'] as const) {
    const staleAt = staleTimeOf(next, kind)
    const lookup = next[kind]
    if (staleAt === null || staleAt > now || !lookup) continue
    next = { ...next, [kind]: { ...lookup, lookupStale: true } }
  }
  return next
}

export const MediaDetailsDialog: FC<Props> = ({
  items,
  initialId,
  settings,
  onClose,
  onSaved,
  onDetailsRefreshed,
  suggestionsPending = {}
}) => {
  const uid = useId()
  // Details the dialog fetched itself; each is only used while the details the
  // composer holds for the item are still the ones it was fetched against.
  const [fetched, setFetched] = useState<FetchedDetails>({})
  const precisionRefs = useRef<(HTMLButtonElement | null)[]>([])
  // `items` is recomputed by the parent while the dialog is open (uploads
  // finish, attachments are removed), so items we have not edited yet fall back
  // to a seed derived from the current `items` instead of a one-time snapshot.
  const seeds = useMemo<Record<string, MediaDetailsDraft>>(
    () =>
      Object.fromEntries(
        items.map((entry) => [
          entry.id,
          draftFromDetails(
            entry.description,
            entry.decorative,
            resolveDetails(entry, fetched)
          )
        ])
      ),
    [items, fetched]
  )
  const [savedOriginals, setOriginals] = useState<
    Record<string, MediaDetailsDraft>
  >({})
  // Only the fields the user changed, per item. Everything else keeps following
  // the seed, so details that arrive late (EXIF read) are neither shown as
  // blanks nor sent back as nulls on Save.
  const [editedDrafts, setDrafts] = useState<
    Record<string, Partial<MediaDetailsDraft>>
  >({})
  const originals = useMemo(
    () => ({ ...seeds, ...savedOriginals }),
    [seeds, savedOriginals]
  )
  const drafts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(originals).map(([id, original]) => [
          id,
          { ...original, ...editedDrafts[id] }
        ])
      ) as Record<string, MediaDetailsDraft>,
    [originals, editedDrafts]
  )
  const [selectedId, setSelectedId] = useState(initialId)
  const [shared, setShared] = useState<SharedSections>({
    gallery: false,
    gear: false,
    place: false
  })
  const [gears, setGears] = useState<GalleryGearEntity[]>([])
  const [gearError, setGearError] = useState<string | null>(null)
  const [addingGear, setAddingGear] = useState<'camera' | 'lens' | null>(null)
  const [newGearName, setNewGearName] = useState('')
  const [gearSaving, setGearSaving] = useState(false)
  const [describing, setDescribing] = useState(false)
  const [describeError, setDescribeError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState<Record<string, true>>({})
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  // Per item, which Retry is running: one item's retry is not another's.
  const [retrying, setRetrying] = useState<Record<string, 'subject' | 'place'>>(
    {}
  )
  // Shown beside the Retry that failed, not the other one.
  const [retryError, setRetryError] = useState<{
    kind: 'subject' | 'place'
    message: string
  } | null>(null)
  // The items as of the latest render, for requests that finish later than
  // the render that started them.
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // The selected item can disappear (removed or failed upload); clamp.
  const foundIndex = items.findIndex((entry) => entry.id === selectedId)
  const index = Math.max(0, foundIndex)
  const item: MediaDetailsDialogItem | undefined = items[index]
  const total = items.length

  useEffect(() => {
    let active = true
    getGalleryGears()
      .then((result) => {
        if (active) setGears(result)
      })
      .catch((error) => {
        if (active) setGearError(errorMessage(error, 'Failed to load gear.'))
      })
    return () => {
      active = false
    }
  }, [])

  const patchDraft = useCallback(
    (patch: Partial<MediaDetailsDraft>) => {
      if (!item) return
      const id = item.id
      setDrafts((current) => ({
        ...current,
        [id]: { ...current[id], ...patch }
      }))
    },
    [item]
  )

  const previousButtonRef = useRef<HTMLButtonElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const focusAfterNavRef = useRef<RefObject<HTMLButtonElement | null> | null>(
    null
  )
  useEffect(() => {
    focusAfterNavRef.current?.current?.focus()
    focusAfterNavRef.current = null
  }, [selectedId])

  const goTo = (next: number) => {
    const target = items[next]
    if (!target) return
    // The button that was just used is about to be disabled at the end of the
    // list; hand focus to its sibling so it does not fall back to the body.
    // Applied after the render, once the sibling is enabled.
    if (next === 0) focusAfterNavRef.current = nextButtonRef
    else if (next === items.length - 1) {
      focusAfterNavRef.current = previousButtonRef
    }
    setDescribeError(null)
    setSuggestError(null)
    setRetryError(null)
    setAddingGear(null)
    setSelectedId(target.id)
  }

  // Reads the selected media again while one of its lookups is under way, so
  // a name or IUCN status the job wrote since shows up without a Retry. The
  // budget is per item and pending state; a failed read still counts and the
  // next one follows.
  const refreshAttempts = useRef<Record<string, number>>({})
  const [refreshTick, setRefreshTick] = useState(0)
  // A ref, so a parent that passes a new callback each render does not
  // restart the wait.
  const onDetailsRefreshedRef = useRef(onDetailsRefreshed)
  useEffect(() => {
    onDetailsRefreshedRef.current = onDetailsRefreshed
  }, [onDetailsRefreshed])
  const itemId = item?.id
  const shownDetails = item ? resolveDetails(item, fetched) : null
  const underWay = isLookupUnderWay(shownDetails)
  const budgetKey =
    itemId && underWay ? `${itemId}#${pendingStateKey(shownDetails)}` : null
  useEffect(() => {
    if (!itemId || !budgetKey) return
    const id = itemId
    const attempts = refreshAttempts.current[budgetKey] ?? 0
    if (attempts >= LOOKUP_REFRESH_ATTEMPTS) return
    let active = true
    const timer = setTimeout(
      async () => {
        refreshAttempts.current[budgetKey] = attempts + 1
        try {
          const media = await getMedia(id)
          if (!active || !media.details) return
          const value = withClientStaleness(media.details, Date.now())
          const latest = itemsRef.current.find((entry) => entry.id === id)
          if (!latest) return
          setFetched((existing) => ({
            ...existing,
            [id]: { base: latest.details, value }
          }))
          // Only the lookups' results: suggestions fetched meanwhile stay.
          onDetailsRefreshedRef.current?.(
            id,
            { subject: value.subject, place: value.place },
            value
          )
        } catch {
          // Best effort: the next read (or Retry) may do better.
        } finally {
          if (active) setRefreshTick((tick) => tick + 1)
        }
      },
      attempts === 0 ? 0 : LOOKUP_REFRESH_DELAY_MS
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [itemId, budgetKey, refreshTick])

  // Once a pending lookup is older than the stale limit, it is marked stale
  // here, so Retry shows without reopening the dialog even after the reads
  // above have run out.
  const subjectStaleAt = staleTimeOf(shownDetails, 'subject')
  const placeStaleAt = staleTimeOf(shownDetails, 'place')
  const staleAt =
    subjectStaleAt === null
      ? placeStaleAt
      : placeStaleAt === null
        ? subjectStaleAt
        : Math.min(subjectStaleAt, placeStaleAt)
  useEffect(() => {
    if (!itemId || staleAt === null) return
    const id = itemId
    const timer = setTimeout(
      () => {
        const latest = itemsRef.current.find((entry) => entry.id === id)
        if (!latest) return
        setFetched((existing) => {
          const details = resolveDetails(latest, existing)
          if (!details) return existing
          const value = withClientStaleness(details, Date.now())
          if (value === details) return existing
          return { ...existing, [id]: { base: latest.details, value } }
        })
      },
      Math.max(0, staleAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [itemId, staleAt])

  if (!item) return null
  const draft = drafts[item.id]
  const video = isVideo(item)

  const onRegenerate = async () => {
    const targetId = item.id
    setDescribing(true)
    setDescribeError(null)
    try {
      const text = await describeMedia(targetId)
      setDrafts((current) => ({
        ...current,
        [targetId]: {
          ...current[targetId],
          description: text.slice(0, MAX_MEDIA_DESCRIPTION_LENGTH),
          decorative: false
        }
      }))
    } catch (error) {
      setDescribeError(errorMessage(error, 'Failed to generate a description.'))
    } finally {
      setDescribing(false)
    }
  }

  const onSuggest = async () => {
    const target = item
    setSuggesting((current) => ({ ...current, [target.id]: true }))
    setSuggestError(null)
    try {
      const suggestions = await suggestMediaSubjects(target.id)
      // The model can take seconds; a Retry may have refreshed the item
      // meanwhile. Merge only the suggestions into the details as they are
      // NOW, never into the ones captured when Suggest was clicked.
      const patch = { subjectSuggestions: suggestions }
      const latest =
        itemsRef.current.find((entry) => entry.id === target.id) ?? target
      setFetched((current) => ({
        ...current,
        [target.id]: {
          base: latest.details,
          value: mergeDetails(resolveDetails(latest, current), patch)
        }
      }))
      onDetailsRefreshed?.(
        target.id,
        patch,
        mergeDetails(latest.details, patch)
      )
    } catch (error) {
      setSuggestError(errorMessage(error, 'Subjects could not be suggested.'))
    } finally {
      setSuggesting((current) => {
        const { [target.id]: _done, ...rest } = current
        return rest
      })
    }
  }

  const onRetryLookups = async (kind: 'subject' | 'place') => {
    const target = item
    setRetrying((current) => ({ ...current, [target.id]: kind }))
    setRetryError(null)
    // A Retry starts the reads afresh, whatever the last pending state used.
    for (const key of Object.keys(refreshAttempts.current)) {
      if (key.startsWith(`${target.id}#`)) delete refreshAttempts.current[key]
    }
    try {
      // The server's answer is the whole, current entity.
      const value = await retryMediaLookups(target.id)
      const latest =
        itemsRef.current.find((entry) => entry.id === target.id) ?? target
      setFetched((current) => ({
        ...current,
        [target.id]: { base: latest.details, value }
      }))
      onDetailsRefreshed?.(target.id, value, value)
      setRefreshTick((tick) => tick + 1)
    } catch (error) {
      setRetryError({
        kind,
        message: errorMessage(error, 'Failed to retry the check.')
      })
    } finally {
      setRetrying((current) => {
        const { [target.id]: _done, ...rest } = current
        return rest
      })
    }
  }

  const applySubjectTo = (picked: PickedSubject, everyItem: boolean) => {
    const patch = subjectPatch(picked)
    setDrafts((current) => {
      const next = { ...current }
      const targets = everyItem ? items.map((entry) => entry.id) : [item.id]
      for (const id of targets) next[id] = { ...next[id], ...patch }
      return next
    })
  }

  const onAddGear = async () => {
    const name = newGearName.trim()
    if (!addingGear || !name) return
    setGearSaving(true)
    setGearError(null)
    try {
      const gear = await createGalleryGear({ kind: addingGear, name })
      setGears((current) => [...current, gear])
      patchDraft(
        addingGear === 'camera'
          ? { cameraGearId: gear.id }
          : { lensGearId: gear.id }
      )
      setAddingGear(null)
      setNewGearName('')
    } catch (error) {
      setGearError(errorMessage(error, 'Failed to save gear.'))
    } finally {
      setGearSaving(false)
    }
  }

  const onSave = async () => {
    setSaving(true)
    setSaveError(null)
    const saved: MediaDetailsSavedItem[] = []
    const savedNow: Record<string, MediaDetailsDraft> = {}
    let failure: string | null = null
    for (const target of items) {
      const effective = applySharedSections(drafts[target.id], draft, shared)
      const original = originals[target.id]
      const fields = diffDraft(original, effective)
      const decorativeChanged = original.decorative !== effective.decorative
      if (Object.keys(fields).length === 0 && !decorativeChanged) continue
      try {
        if (Object.keys(fields).length > 0) {
          const updated = await updateMediaDetails(target.id, fields)
          saved.push({
            id: target.id,
            // The row's description is only authoritative when this save sent
            // one; otherwise keep what the composer already shows.
            description:
              fields.description !== undefined
                ? (updated.description ?? '')
                : (effectiveDescription(effective) ?? ''),
            decorative: effective.decorative,
            details: updated.details
          })
        } else {
          saved.push({
            id: target.id,
            description: effectiveDescription(effective) ?? '',
            decorative: effective.decorative
          })
        }
        savedNow[target.id] = effective
      } catch (error) {
        failure = `Could not save ${target.id === item.id ? 'this item' : `item ${items.indexOf(target) + 1}`}: ${errorMessage(error, 'Failed to save media details.')}`
        break
      }
    }
    if (saved.length > 0) onSaved(saved)
    setSaving(false)
    if (failure) {
      // Only the saved items get a new baseline; the failed item and the ones
      // after it keep the user's unsaved drafts so Save can simply be retried.
      setOriginals((current) => ({ ...current, ...savedNow }))
      setDrafts((current) => {
        const next = { ...current }
        for (const id of Object.keys(savedNow)) delete next[id]
        return next
      })
      setSaveError(failure)
      return
    }
    onClose()
  }

  // Retired gear is out of the pickers, except the one this media already
  // carries: hiding it would make the select read as "none" and a save would
  // silently clear it.
  const cameras = gears.filter(
    (g) => g.kind === 'camera' && (!g.retiredAt || g.id === draft.cameraGearId)
  )
  const lenses = gears.filter(
    (g) => g.kind === 'lens' && (!g.retiredAt || g.id === draft.lensGearId)
  )
  const withCurrent = (
    list: GalleryGearEntity[],
    currentId: string,
    currentName: string | undefined
  ) =>
    currentId && currentName && !list.some((g) => g.id === currentId)
      ? [
          ...list,
          { id: currentId, name: currentName } as Pick<
            GalleryGearEntity,
            'id' | 'name'
          >
        ]
      : list

  const details = resolveDetails(item, fetched)
  const exposure = details?.exposure
  const exposureChips = [
    exposure?.focalLengthMm ? `${exposure.focalLengthMm} mm` : null,
    exposure?.aperture ? `f/${exposure.aperture}` : null,
    exposure?.exposureTime ? `${exposure.exposureTime} s` : null,
    exposure?.iso ? `ISO ${exposure.iso}` : null
  ].filter((chip): chip is string => chip !== null)
  const hasFilePlace =
    details?.place?.latitude != null && details?.place?.longitude != null
  const precision: MediaPlacePrecision =
    draft.placePrecision || settings?.defaultPlacePrecision || 'hidden'

  // Smart subjects: the model's candidates, when the server and the author's
  // setting allow them, and GBIF search when species lookups are on.
  const canSuggest =
    Boolean(settings?.subjectSuggestionsAvailable) &&
    settings?.subjectSuggestionMode === 'model'
  const canSearch = settings?.speciesLookupsAvailable === true
  const suggestions: SubjectSuggestionsEntity | null = canSuggest
    ? (details?.subjectSuggestions ?? null)
    : null
  const isSuggesting = Boolean(
    suggesting[item.id] || suggestionsPending[item.id]
  )
  const hasAssist = canSuggest || canSearch
  const showManual = !hasAssist || manualOpen
  const subjectPath = draft.subjectTaxonPath
  const showPathLine =
    subjectPath.length > 0 || (hasAssist && draft.subjectScientificName !== '')

  // The lookup status belongs to the subject as saved, so it is only shown
  // while the draft still holds that subject.
  const savedSubject = originals[item.id]
  const subjectUnchanged =
    draft.subjectName === savedSubject.subjectName &&
    draft.subjectScientificName === savedSubject.subjectScientificName &&
    draft.subjectTaxonKey === savedSubject.subjectTaxonKey
  const subjectStatus = subjectUnchanged ? (details?.subject ?? null) : null
  const placeStatus = details?.place ?? null

  const onPrecisionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = MEDIA_PLACE_PRECISIONS.length
    const current = MEDIA_PLACE_PRECISIONS.indexOf(precision)
    let nextIndex: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (current + 1) % count
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (current - 1 + count) % count
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = count - 1
    } else {
      return
    }
    event.preventDefault()
    patchDraft({ placePrecision: MEDIA_PLACE_PRECISIONS[nextIndex] })
    // Roving tabindex: focus follows the selection.
    precisionRefs.current[nextIndex]?.focus()
  }

  const idFor = (name: string) => `${uid}-${name}`
  const descriptionLength = draft.description.length

  const gearSelect = (
    kind: 'camera' | 'lens',
    label: string,
    value: string,
    list: Pick<GalleryGearEntity, 'id' | 'name'>[]
  ) => (
    <Field label={label} htmlFor={idFor(kind)}>
      <Select
        id={idFor(kind)}
        value={value}
        onChange={(event) => {
          if (event.target.value === ADD_NEW_GEAR) {
            setAddingGear(kind)
            setNewGearName('')
            return
          }
          setAddingGear(null)
          patchDraft(
            kind === 'camera'
              ? { cameraGearId: event.target.value }
              : { lensGearId: event.target.value }
          )
        }}
      >
        <option value="">None</option>
        {list.map((gear) => (
          <option key={gear.id} value={gear.id}>
            {gear.name}
          </option>
        ))}
        <option value={ADD_NEW_GEAR}>Add new…</option>
      </Select>
      {addingGear === kind ? (
        <div className="flex items-center gap-2 pt-1">
          <Input
            aria-label={`New ${kind} name`}
            placeholder={kind === 'camera' ? 'Camera name' : 'Lens name'}
            value={newGearName}
            onChange={(event) => setNewGearName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void onAddGear()
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={gearSaving || !newGearName.trim()}
            onClick={() => void onAddGear()}
          >
            {gearSaving ? <Loader2 className="animate-spin" /> : null}
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAddingGear(null)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </Field>
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          'flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0',
          // Below md: a bottom sheet. From md: a centred two-column dialog.
          'top-auto bottom-0 left-0 max-w-full translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl sm:max-w-full',
          'md:top-[50%] md:bottom-auto md:left-[50%] md:max-w-[1040px] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-2xl md:max-h-[88dvh] md:sm:max-w-[1040px]'
        )}
      >
        <DialogDescription className="sr-only">
          Review the description, subject, gear and place of each media item.
        </DialogDescription>
        <header className="flex items-center gap-3 border-b px-5 py-3">
          <DialogTitle className="text-base">
            {video ? 'Video details' : 'Media details'}
          </DialogTitle>
          <span className="text-sm text-muted-foreground">
            {index + 1} of {total}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              ref={previousButtonRef}
              aria-label="Previous item"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              ref={nextButtonRef}
              aria-label="Next item"
              disabled={index === total - 1}
              onClick={() => goTo(index + 1)}
            >
              <ChevronRight />
            </Button>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                disabled={saving}
              >
                <X />
              </Button>
            </DialogClose>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:overflow-hidden">
          <div className="min-w-0 space-y-3 bg-muted/40 p-5 md:overflow-y-auto">
            <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted">
              {video ? (
                <video
                  key={item.id}
                  controls
                  src={item.url}
                  poster={item.posterUrl}
                  className="max-h-[50dvh] w-full object-contain"
                />
              ) : (
                <img
                  src={item.url}
                  alt={
                    effectiveDescription(draft) ??
                    `Preview of item ${index + 1}`
                  }
                  className="max-h-[50dvh] w-full object-contain"
                />
              )}
            </div>
            {total > 1 ? (
              <ul className="flex gap-2 overflow-x-auto p-1" aria-label="Items">
                {items.map((thumb, thumbIndex) => (
                  <li key={thumb.id} className="shrink-0">
                    <button
                      type="button"
                      aria-label={`Item ${thumbIndex + 1}`}
                      aria-current={thumbIndex === index ? 'true' : undefined}
                      onClick={() => goTo(thumbIndex)}
                      className={cn(
                        'relative block size-14 rounded-md bg-muted bg-cover bg-center',
                        thumbIndex === index
                          ? 'outline-2 outline-offset-2 outline-primary'
                          : 'opacity-80 hover:opacity-100'
                      )}
                      style={{
                        backgroundImage: `url("${thumb.posterUrl || thumb.url}")`
                      }}
                    >
                      {isVideo(thumb) ? (
                        <span className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-black/60 text-white">
                          <Play className="size-2.5 fill-current" />
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              {details?.takenAt ? (
                <>
                  <dt className="text-muted-foreground">Taken</dt>
                  <dd>{formatTakenAt(details.takenAt)}</dd>
                </>
              ) : null}
              {item.width > 0 && item.height > 0 ? (
                <>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>
                    {item.width} × {item.height}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="min-w-0 md:overflow-y-auto">
            <Section title="Show in my gallery">
              <div
                className={cn(
                  'space-y-2 rounded-lg border p-3',
                  draft.inGallery && 'bg-primary/5'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={idFor('gallery')} className="text-sm">
                    Show in my gallery
                  </Label>
                  <Switch
                    id={idFor('gallery')}
                    checked={draft.inGallery}
                    onCheckedChange={(checked) =>
                      patchDraft({ inGallery: checked })
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Adds it to Subjects, Map and Gear. The post is the same either
                  way.
                </p>
                {total > 1 ? (
                  <CheckRow
                    id={idFor('gallery-all')}
                    checked={shared.gallery}
                    onChange={(checked) =>
                      setShared((s) => ({ ...s, gallery: checked }))
                    }
                  >
                    Show all {total} items in my gallery
                  </CheckRow>
                ) : null}
              </div>
            </Section>

            {video ? (
              <Section title="Cover and description frame">
                <div
                  className="h-20 w-32 rounded-md bg-muted bg-cover bg-center"
                  role="img"
                  aria-label="Cover frame"
                  style={{
                    backgroundImage: item.posterUrl
                      ? `url("${item.posterUrl}")`
                      : undefined
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  The subject and description are suggested from this frame.
                </p>
              </Section>
            ) : null}

            <Section title="Subject">
              <SubjectSuggestions
                suggestions={suggestions}
                threshold={settings?.subjectConfidenceThreshold ?? 70}
                draft={draft}
                canSuggest={canSuggest}
                suggesting={isSuggesting}
                error={suggestError}
                canSearch={canSearch}
                showChosen={!showManual}
                onPick={(picked) => applySubjectTo(picked, false)}
                onClear={() => applySubjectTo(NO_SUBJECT, false)}
                onSuggest={() => void onSuggest()}
                onSearch={() => setPickerOpen(true)}
              />
              {showPathLine ? (
                <TaxonPathLine
                  scientificName={draft.subjectScientificName}
                  path={subjectPath}
                />
              ) : null}
              {subjectStatus ? (
                <SubjectLookupStatus
                  subject={subjectStatus}
                  hidePlaces={settings?.hideThreatenedPlaces ?? true}
                  canRetry={canSearch}
                  retrying={retrying[item.id] === 'subject'}
                  disabled={Boolean(retrying[item.id])}
                  error={
                    retryError?.kind === 'subject' ? retryError.message : null
                  }
                  onRetry={() => void onRetryLookups('subject')}
                />
              ) : null}
              {hasAssist ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={showManual}
                  aria-controls={idFor('subject-manual')}
                  className="-ml-2"
                  onClick={() => setManualOpen((open) => !open)}
                >
                  Edit manually
                </Button>
              ) : null}
              <div
                id={idFor('subject-manual')}
                hidden={!showManual}
                className="space-y-3"
              >
                <Field label="Name" htmlFor={idFor('subject-name')}>
                  <Input
                    id={idFor('subject-name')}
                    value={draft.subjectName}
                    onChange={(event) =>
                      patchDraft({ subjectName: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Scientific name"
                  htmlFor={idFor('subject-scientific')}
                >
                  <Input
                    id={idFor('subject-scientific')}
                    value={draft.subjectScientificName}
                    onChange={(event) =>
                      // A different scientific name is a different taxon, so the
                      // matched one no longer applies; the server clears it too.
                      patchDraft({
                        subjectScientificName: event.target.value,
                        subjectTaxonKey: '',
                        subjectTaxonPath: []
                      })
                    }
                  />
                </Field>
                <Field label="Category" htmlFor={idFor('subject-category')}>
                  <Select
                    id={idFor('subject-category')}
                    value={draft.subjectCategory}
                    onChange={(event) =>
                      patchDraft({
                        subjectCategory: event.target.value as
                          MediaSubjectCategory | ''
                      })
                    }
                  >
                    <option value="">No category</option>
                    {MEDIA_SUBJECT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {capitalize(category)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Section>

            <Section title="Description (alt text)">
              <Textarea
                aria-label="Description (alt text)"
                value={draft.description}
                maxLength={MAX_MEDIA_DESCRIPTION_LENGTH}
                disabled={draft.decorative || describing}
                rows={4}
                onChange={(event) =>
                  patchDraft({ description: event.target.value })
                }
              />
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs tabular-nums text-muted-foreground"
                  aria-live="off"
                >
                  {descriptionLength}/{MAX_MEDIA_DESCRIPTION_LENGTH}
                </span>
                {settings?.altTextAvailable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={describing}
                    onClick={() => void onRegenerate()}
                  >
                    {describing ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Sparkles />
                    )}
                    Regenerate
                  </Button>
                ) : null}
              </div>
              {describeError ? (
                <p role="alert" className="text-xs text-destructive">
                  {describeError}
                </p>
              ) : null}
              <CheckRow
                id={idFor('decorative')}
                checked={draft.decorative}
                onChange={(checked) => patchDraft({ decorative: checked })}
              >
                Post without a description (decorative image)
              </CheckRow>
            </Section>

            <Section title="Gear">
              {gearSelect(
                'camera',
                'Camera',
                draft.cameraGearId,
                withCurrent(cameras, draft.cameraGearId, details?.camera?.name)
              )}
              {gearSelect(
                'lens',
                'Lens',
                draft.lensGearId,
                withCurrent(lenses, draft.lensGearId, details?.lens?.name)
              )}
              {gearError ? (
                <p role="alert" className="text-xs text-destructive">
                  {gearError}
                </p>
              ) : null}
              {/* A new tab: the dialog also opens from the composer's upload
                  flow, and navigating here would unmount the composer and lose
                  its unposted text and attachments. */}
              <Link
                href="/gallery/gear"
                target="_blank"
                rel="noopener"
                prefetch={false}
                className="text-xs font-medium text-primary-text hover:underline"
              >
                Manage gear{' '}
                <span className="sr-only">(opens in a new tab)</span>
              </Link>
              {exposureChips.length > 0 ? (
                <ul
                  className="flex flex-wrap gap-1.5"
                  aria-label="Exposure from file"
                >
                  {exposureChips.map((chip) => (
                    <li key={chip}>
                      <Badge>{chip}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              {total > 1 ? (
                <CheckRow
                  id={idFor('gear-all')}
                  checked={shared.gear}
                  onChange={(checked) =>
                    setShared((s) => ({ ...s, gear: checked }))
                  }
                >
                  Use this gear for all {total} items
                </CheckRow>
              ) : null}
            </Section>

            <Section
              title="Place"
              aside={
                hasFilePlace && settings?.placeLookupsAvailable ? (
                  <span className="text-xs text-muted-foreground">
                    Place names © OpenStreetMap contributors
                  </span>
                ) : undefined
              }
            >
              <Field label="Place name" htmlFor={idFor('place-name')}>
                <div className="flex items-center gap-2">
                  <Input
                    id={idFor('place-name')}
                    value={draft.placeName}
                    onChange={(event) =>
                      patchDraft({ placeName: event.target.value })
                    }
                  />
                  {hasFilePlace ? (
                    <Badge className="shrink-0 gap-1">
                      <MapPin className="size-3" />
                      From file
                    </Badge>
                  ) : null}
                </div>
              </Field>
              <PlaceLookupStatus
                place={placeStatus}
                canRetry={settings?.placeLookupsAvailable !== false}
                retrying={retrying[item.id] === 'place'}
                disabled={Boolean(retrying[item.id])}
                error={retryError?.kind === 'place' ? retryError.message : null}
                onRetry={() => void onRetryLookups('place')}
              />
              <div
                role="radiogroup"
                aria-label="Place precision"
                className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1"
                onKeyDown={onPrecisionKeyDown}
              >
                {MEDIA_PLACE_PRECISIONS.map((option, optionIndex) => (
                  <button
                    key={option}
                    ref={(node) => {
                      precisionRefs.current[optionIndex] = node
                    }}
                    type="button"
                    role="radio"
                    aria-checked={precision === option}
                    tabIndex={precision === option ? 0 : -1}
                    onClick={() => patchDraft({ placePrecision: option })}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      precision === option
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {PRECISION_LABELS[option]}
                  </button>
                ))}
              </div>
              {total > 1 ? (
                <CheckRow
                  id={idFor('place-all')}
                  checked={shared.place}
                  onChange={(checked) =>
                    setShared((s) => ({ ...s, place: checked }))
                  }
                >
                  Use this place for all {total} items
                </CheckRow>
              ) : null}
            </Section>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
          {saveError ? (
            <p role="alert" className="mr-auto text-xs text-destructive">
              {saveError}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void onSave()}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save details
          </Button>
        </footer>
        {pickerOpen ? (
          <SpeciesPickerDialog
            photo={{
              url: item.posterUrl || item.url,
              alt: effectiveDescription(draft) ?? `Preview of item ${index + 1}`
            }}
            position={{ index, total }}
            suggestions={suggestions}
            onCancel={() => setPickerOpen(false)}
            onUse={(picked, everyItem) => {
              applySubjectTo(picked, everyItem)
              setPickerOpen(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

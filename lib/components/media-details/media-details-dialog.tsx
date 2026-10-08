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
import {
  FC,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  createGalleryGear,
  describeMedia,
  getGalleryGears,
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
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import {
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES,
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import {
  MediaDetailsDraft,
  SharedSections,
  applySharedSections,
  diffDraft,
  draftFromDetails,
  effectiveDescription
} from './mediaDetailsDraft'

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
}

const ADD_NEW_GEAR = '__add_new_gear__'

const PRECISION_LABELS: Record<MediaPlacePrecision, string> = {
  hidden: 'Hidden',
  country: 'Country',
  area: 'Area · 5 km',
  exact: 'Exact'
}

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1)

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

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const Section: FC<{ title: string; children: ReactNode }> = ({
  title,
  children
}) => (
  <section className="space-y-3 border-b px-5 py-4 last:border-b-0">
    <h3 className="text-sm font-semibold">{title}</h3>
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

export const MediaDetailsDialog: FC<Props> = ({
  items,
  initialId,
  settings,
  onClose,
  onSaved
}) => {
  const uid = useId()
  const precisionRefs = useRef<(HTMLButtonElement | null)[]>([])
  // `items` is recomputed by the parent while the dialog is open (uploads
  // finish, attachments are removed), so items we have not edited yet fall back
  // to a seed derived from the current `items` instead of a one-time snapshot.
  const seeds = useMemo<Record<string, MediaDetailsDraft>>(
    () =>
      Object.fromEntries(
        items.map((entry) => [
          entry.id,
          draftFromDetails(entry.description, entry.decorative, entry.details)
        ])
      ),
    [items]
  )
  const [savedOriginals, setOriginals] = useState<
    Record<string, MediaDetailsDraft>
  >({})
  const [editedDrafts, setDrafts] = useState<Record<string, MediaDetailsDraft>>(
    {}
  )
  const originals = useMemo(
    () => ({ ...seeds, ...savedOriginals }),
    [seeds, savedOriginals]
  )
  const drafts = useMemo(
    () => ({ ...originals, ...editedDrafts }),
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
        [id]: { ...(current[id] ?? drafts[id]), ...patch }
      }))
    },
    [item, drafts]
  )

  const goTo = (next: number) => {
    const target = items[next]
    if (!target) return
    setDescribeError(null)
    setAddingGear(null)
    setSelectedId(target.id)
  }

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
          ...(current[targetId] ?? drafts[targetId]),
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
            description: updated.description ?? '',
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
        for (const id of Object.keys(savedNow)) next[id] = savedNow[id]
        return next
      })
      setSaveError(failure)
      return
    }
    onClose()
  }

  const cameras = gears.filter((g) => g.kind === 'camera' && !g.retiredAt)
  const lenses = gears.filter((g) => g.kind === 'lens' && !g.retiredAt)
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

  const details = item.details
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
          <div className="space-y-3 bg-muted/40 p-5 md:overflow-y-auto">
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

          <div className="md:overflow-y-auto">
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
                    patchDraft({ subjectScientificName: event.target.value })
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

            <Section title="Place">
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
      </DialogContent>
    </Dialog>
  )
}

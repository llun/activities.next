'use client'

import { Folder, Globe, Lock, Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import {
  FC,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  addGalleryAlbumItems,
  createGalleryAlbum,
  updateGalleryAlbum
} from '@/lib/client'
import {
  GALLERY_ALBUM_ITEMS_BATCH,
  GalleryAlbumAddError
} from '@/lib/client/galleryAlbums'
import { AlbumUndoToast } from '@/lib/components/gallery/AlbumUndoToast'
import {
  EMPTY_GALLERY_FILTERS,
  setGalleryFilter
} from '@/lib/components/gallery/filters/galleryMediaFilterState'
import { pluralize } from '@/lib/components/gallery/galleryCategories'
import type { AlbumToast } from '@/lib/components/gallery/useMediaAlbums'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { RadioCard } from '@/lib/components/surface/RadioCard'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { RadioGroup } from '@/lib/components/ui/radio-group'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import { Textarea } from '@/lib/components/ui/textarea'
import type { GalleryAlbumCardEntity } from '@/lib/services/gallery/galleryAlbumEntities'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import {
  type GalleryItemEntity,
  toUtcDay
} from '@/lib/services/gallery/galleryEntities'
import {
  DEFAULT_GALLERY_ALBUM_VISIBILITY,
  GALLERY_ALBUM_VISIBILITIES,
  type GalleryAlbumVisibility,
  MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH,
  MAX_GALLERY_ALBUM_ITEMS,
  MAX_GALLERY_ALBUM_TITLE_LENGTH
} from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

import { GalleryAlbumSuggestionList } from './GalleryAlbumSuggestionList'
import { GalleryAlbumSuggestionReview } from './GalleryAlbumSuggestionReview'
import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import { formatAlbumDateRange } from './galleryAlbumsUi'
import type { GalleryAlbumSuggestionsState } from './useGalleryAlbumSuggestions'

/**
 * `create` is the whole form with the picker; `edit` is the details alone and
 * `add` is the picker alone, for an album that already exists.
 */
export type GalleryAlbumFormIntent = 'create' | 'edit' | 'add'

// The picker and the filter bar behind it are only needed once the dialog is
// open: keep them out of every page that merely links to the dialog.
const GalleryAlbumPicker = dynamic(
  () =>
    import('./GalleryAlbumPicker').then((module) => module.GalleryAlbumPicker),
  {
    ssr: false,
    loading: () => (
      <div className="skeleton h-40 rounded-md" aria-hidden="true" />
    )
  }
)

// The picks strip (and the phone sheet it opens) is only needed once the
// dialog is open: keep it out of every page that merely links to the dialog.
const GalleryAlbumPicksStrip = dynamic(
  () =>
    import('./GalleryAlbumPicksStrip').then(
      (module) => module.GalleryAlbumPicksStrip
    ),
  {
    ssr: false,
    loading: () => (
      <div className="skeleton h-10 rounded-md" aria-hidden="true" />
    )
  }
)

/** The two ways to choose photos in the create dialog. */
export type GalleryAlbumPickerTab = 'gallery' | 'suggestions'

interface Props {
  open: boolean
  ownerId: string
  intent: GalleryAlbumFormIntent
  /** The album being edited or added to; absent when creating. */
  album?: GalleryAlbumCardEntity | null
  /** Media ids already in the album, shown as such (and not pickable) in the picker. */
  existingMediaIds?: string[]
  /**
   * How many items count against the album's cap, including photos the owner
   * can no longer see. Defaults to the visible count.
   */
  storedItemCount?: number
  /**
   * Photos to start the new album with, picked before the dialog opened (the
   * photo whose menu asked for "New album", or a selection from All media). Only
   * for `create`; the first is the cover, as for a photo ticked in the picker.
   */
  initialMediaIds?: string[]
  /** The loaded entities behind `initialMediaIds`, when the caller has them (for the cover). */
  initialItems?: GalleryItemEntity[]
  /**
   * The owner's suggestions, as `useGalleryAlbumSuggestions` reads them. With
   * them, creating an album or adding photos offers a Suggestions tab next to
   * From gallery; a suggestion's "Use" selects its photos and (when creating)
   * fills the title, and the owner can still add and remove photos. Without
   * them there is no tab.
   */
  suggestions?: { state: GalleryAlbumSuggestionsState; reload: () => void }
  /** The tab that is open first when the dialog has both. */
  initialTab?: GalleryAlbumPickerTab
  onOpenChange: (open: boolean) => void
  /** Called with the album id once everything asked for is saved. */
  onSaved: (albumId: string) => void
  /**
   * Where focus goes once the dialog has closed, for a caller whose opening
   * button is gone by then (`preventDefault` and focus something).
   */
  onCloseAutoFocus?: (event: Event) => void
}

const VISIBILITY_COPY: Record<
  GalleryAlbumVisibility,
  { label: string; hint: string; icon: typeof Globe }
> = {
  public: {
    label: 'Public',
    hint: 'Anyone with the link can open it, and sees only the photos from posts they may read.',
    icon: Globe
  },
  private: { label: 'Private', hint: 'Only you can see it.', icon: Lock }
}

const TITLES: Record<GalleryAlbumFormIntent, string> = {
  create: 'New album',
  edit: 'Edit album',
  add: 'Add photos'
}

const SUBMIT_LABELS: Record<GalleryAlbumFormIntent, string> = {
  create: 'Create album',
  edit: 'Save changes',
  add: 'Add to album'
}

const TABS: {
  value: GalleryAlbumPickerTab
  label: string
  icon?: typeof Sparkles
}[] = [
  { value: 'gallery', label: 'From gallery' },
  { value: 'suggestions', label: 'Suggestions', icon: Sparkles }
]

const formatCount = (count: number) => count.toLocaleString('en-US')

/**
 * The seeded Date taken chip's label: the album's range in the mockup's
 * unspaced form ("Album dates · 4–12 Oct 2025") for a same-month range, and
 * the hero's spelling everywhere else.
 */
export const formatAlbumDatesChipLabel = (
  firstAt: string,
  lastAt: string
): string => {
  const range = formatAlbumDateRange(firstAt, lastAt)
  if (!range) return ''
  const from = toUtcDay(firstAt)
  const to = toUtcDay(lastAt)
  const sameMonth =
    from !== null && to !== null && from.slice(0, 7) === to.slice(0, 7)
  return `Album dates · ${sameMonth ? range.replace(' – ', '–') : range}`
}

export const GalleryAlbumFormDialog: FC<Props> = ({
  open,
  ownerId,
  intent,
  album = null,
  existingMediaIds,
  storedItemCount,
  initialMediaIds,
  initialItems,
  suggestions,
  initialTab = 'gallery',
  onOpenChange,
  onSaved,
  onCloseAutoFocus
}) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<GalleryAlbumVisibility>(
    DEFAULT_GALLERY_ALBUM_VISIBILITY
  )
  const [selected, setSelected] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [photosError, setPhotosError] = useState<string | null>(null)
  // Set once the album exists but a later step failed, so a retry opens it
  // instead of creating a second one. It also stands for "added": once the
  // photos are in the album, the form is only a way to open it.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const changedAlbumIdRef = useRef<string | null>(null)
  // The cover the owner starred on a pick; null until then (the create
  // default is the first pick, the add default is the album's own cover).
  const [coverId, setCoverId] = useState<string | null>(null)
  // The cover the picker knows (it has shown that photo); a photo chosen from a
  // suggestion is known from the review grid instead.
  const [pickerCover, setPickerCover] =
    useState<GalleryAlbumCardEntity['cover']>(null)
  const [tab, setTab] = useState<GalleryAlbumPickerTab>(initialTab)
  const [activeSuggestion, setActiveSuggestion] =
    useState<GalleryAlbumSuggestionEntity | null>(null)
  // Bumped by every Use, so the review grid starts afresh (filters cleared)
  // for a different suggestion and for the same one used again.
  const [reviewRun, setReviewRun] = useState(0)
  const [knownItems, setKnownItems] = useState<
    ReadonlyMap<string, GalleryItemEntity>
  >(new Map())
  const [toast, setToast] = useState<AlbumToast | null>(null)
  const handleDismissToast = useCallback(() => setToast(null), [])
  // Whether the owner typed the title themselves: a suggestion fills it only
  // while they have not.
  const titleEdited = useRef(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Seed the fields whenever the dialog opens so a cancelled edit never leaks
  // into the next one.
  useEffect(() => {
    if (!open) return
    setTitle(album?.title ?? '')
    setDescription(album?.description ?? '')
    setVisibility(album?.visibility ?? DEFAULT_GALLERY_ALBUM_VISIBILITY)
    setSelected(intent === 'create' ? (initialMediaIds ?? []) : [])
    setError(null)
    setNotice(null)
    setTitleError(null)
    setPhotosError(null)
    setCreatedId(null)
    changedAlbumIdRef.current = null
    setCoverId(null)
    setPickerCover(null)
    setTab(initialTab)
    setActiveSuggestion(null)
    setKnownItems(
      new Map((initialItems ?? []).map((item) => [item.mediaId, item]))
    )
    setToast(null)
    titleEdited.current = false
    // `initialMediaIds` seeds the picker once per opening (the effect runs on
    // open or a new album only): a parent that builds a new array on every
    // render must not reset what was ticked since.
  }, [open, album, initialTab])

  // The host keeps hydrating the seeded photos while the dialog is open
  // (All media loads them in the background): merge the newly loaded
  // entities into `knownItems` so the strip and the Cover field show their
  // real thumbnails. Only ids not known yet are added; entries already
  // known (picked, ticked or hydrated here) are never dropped.
  useEffect(() => {
    if (!open) return
    setKnownItems((current) => {
      let changed = false
      const next = new Map(current)
      for (const item of initialItems ?? []) {
        if (next.has(item.mediaId)) continue
        next.set(item.mediaId, item)
        changed = true
      }
      return changed ? next : current
    })
  }, [open, initialItems])

  // The star only names a photo that is still picked.
  useEffect(() => {
    if (coverId && !selected.includes(coverId)) setCoverId(null)
  }, [coverId, selected])

  // Once the album exists the form is only a way to open it: edits made after
  // that point would be dropped, so the fields stop taking them.
  const isLocked = isSaving || createdId !== null
  const showFields = intent !== 'add'
  const showPicker = intent !== 'edit'
  const showSuggestions =
    (intent === 'create' || intent === 'add') && suggestions !== undefined
  const capacity =
    intent === 'add'
      ? Math.max(
          MAX_GALLERY_ALBUM_ITEMS - (storedItemCount ?? album?.itemCount ?? 0),
          0
        )
      : MAX_GALLERY_ALBUM_ITEMS
  const room = Math.max(capacity - selected.length, 0)
  // A selection seeded from All media can exceed the cap (the picker itself
  // never picks past it): the owner removes the overflow from the strip
  // before the album can be created or added to.
  const overCapCount = Math.max(selected.length - capacity, 0)

  // The starred pick: the owner's ★, or the first pick when creating.
  const starId = coverId ?? (intent === 'create' ? (selected[0] ?? null) : null)
  const starName = starId
    ? (knownItems.get(starId)?.subject?.name ?? 'Photo')
    : null

  // The picker's cover is the first pick it has shown: it only stands in
  // for the starred photo when they are the same photo.
  const coverItem = starId
    ? (knownItems.get(starId) ??
      (pickerCover?.mediaId === starId ? pickerCover : null))
    : null

  // Add photos opens on the album's dates, as one clearable chip.
  const pickerInitialFilters = useMemo(() => {
    if (intent !== 'add' || !album?.firstAt || !album.lastAt) return undefined
    const from = toUtcDay(album.firstAt)
    const to = toUtcDay(album.lastAt)
    if (!from || !to) return undefined
    return setGalleryFilter(EMPTY_GALLERY_FILTERS, 'date', {
      kind: 'custom',
      from,
      to,
      label: formatAlbumDatesChipLabel(album.firstAt, album.lastAt)
    })
  }, [intent, album])

  const handleItemsLoaded = useCallback((items: GalleryItemEntity[]) => {
    setKnownItems((current) => {
      const next = new Map(current)
      for (const item of items) next.set(item.mediaId, item)
      return next
    })
  }, [])

  const handleRemovePick = useCallback((id: string) => {
    setSelected((current) => current.filter((entry) => entry !== id))
  }, [])

  const handleClearPicks = useCallback(() => setSelected([]), [])

  const handleUseSuggestion = (suggestion: GalleryAlbumSuggestionEntity) => {
    const skip = new Set([
      ...selected,
      ...(intent === 'add' ? (existingMediaIds ?? []) : [])
    ])
    const unpicked = suggestion.mediaIds.filter((id) => !skip.has(id))
    const additions = unpicked.slice(0, Math.max(capacity - selected.length, 0))
    if (additions.length > 0) {
      setSelected([...selected, ...additions])
      const added = new Set(additions)
      setToast({
        id: Date.now(),
        message: `Added ${pluralize(additions.length, 'photo')} to your selection`,
        undo: () =>
          setSelected((current) => current.filter((id) => !added.has(id)))
      })
    } else if (unpicked.length > 0) {
      setToast({
        id: Date.now(),
        message: 'Your selection is full.',
        undo: null
      })
    } else {
      setToast({
        id: Date.now(),
        message: 'These photos are already selected.',
        undo: null
      })
    }
    setActiveSuggestion(suggestion)
    setReviewRun((run) => run + 1)
    if (intent === 'create' && (!titleEdited.current || !title.trim())) {
      setTitle(suggestion.title)
      titleEdited.current = false
      setTitleError(null)
    }
    setError(null)
    setPhotosError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (createdId) {
      onSaved(createdId)
      onOpenChange(false)
      return
    }

    setNotice(null)
    setTitleError(null)
    setPhotosError(null)
    const trimmedTitle = title.trim()
    if (showFields && !trimmedTitle) {
      setTitleError('Give the album a title.')
      // Focus moves to the invalid input so its description is read.
      titleInputRef.current?.focus()
      return
    }
    if (intent === 'add' && selected.length === 0) {
      setPhotosError('Choose at least one photo.')
      return
    }
    // The strip's ✕ / Clear brings the selection back within the cap; the
    // rule line under the strip says by how much.
    if (overCapCount > 0) return

    setError(null)
    setIsSaving(true)
    let albumId = album?.id ?? null
    try {
      if (intent === 'create') {
        const firstBatch = selected.slice(0, GALLERY_ALBUM_ITEMS_BATCH)
        const rest = selected.slice(GALLERY_ALBUM_ITEMS_BATCH)
        const starredInFirstBatch =
          starId !== null && firstBatch.includes(starId)
        const created = await createGalleryAlbum({
          title: trimmedTitle,
          description: description.trim() || null,
          visibility,
          mediaIds: firstBatch,
          coverMediaId: starredInFirstBatch ? starId : undefined
        })
        albumId = created.album.id
        setCreatedId(created.album.id)
        const starInFirstBatch =
          starId !== null &&
          (created.added.includes(starId) || created.existing.includes(starId))
        let restResult: Awaited<
          ReturnType<typeof addGalleryAlbumItems>
        > | null = null
        if (rest.length > 0) {
          try {
            restResult = await addGalleryAlbumItems(created.album.id, rest)
          } catch (restError) {
            const starInPartialResult =
              starId !== null &&
              restError instanceof GalleryAlbumAddError &&
              restError.result !== null &&
              (restError.result.added.includes(starId) ||
                restError.result.existing.includes(starId))
            if (starInPartialResult) {
              try {
                await updateGalleryAlbum(created.album.id, {
                  coverMediaId: starId
                })
              } catch (coverError) {
                const message =
                  coverError instanceof Error
                    ? coverError.message
                    : 'Failed to save.'
                setError(
                  `The album was created, but not everything was added and the cover wasn’t changed: ${message}`
                )
                return
              }
            } else if (
              starId !== null &&
              !starInFirstBatch &&
              restError instanceof GalleryAlbumAddError
            ) {
              const name = knownItems.get(starId)?.subject?.name ?? 'Photo'
              setNotice(
                `The album was created, but ${name} wasn’t added, so the cover is unchanged.`
              )
            }
            throw restError
          }
        }
        if (starId) {
          const starInRest =
            restResult !== null &&
            (restResult.added.includes(starId) ||
              restResult.existing.includes(starId))
          if (!starInFirstBatch && !starInRest) {
            if (coverId !== null) {
              const name = knownItems.get(starId)?.subject?.name ?? 'Photo'
              setNotice(
                `The album was created, but ${name} wasn’t added, so the cover is unchanged.`
              )
              return
            }
          }
          if (!starredInFirstBatch && coverId !== null && starInRest) {
            try {
              await updateGalleryAlbum(created.album.id, {
                coverMediaId: starId
              })
            } catch (coverError) {
              const message =
                coverError instanceof Error
                  ? coverError.message
                  : 'Failed to save.'
              setError(
                `Added ${pluralize(selected.length, 'photo')}, but the cover wasn’t changed: ${message}`
              )
              return
            }
          }
        }
      } else if (intent === 'edit' && album) {
        await updateGalleryAlbum(album.id, {
          title: trimmedTitle,
          description: description.trim() || null,
          visibility
        })
      } else if (album) {
        const result = await addGalleryAlbumItems(album.id, selected)
        // A retry after a partial batch failure reports the batches that
        // already made it in as existing: either way the starred photo is in
        // the album now.
        const coverInAlbum =
          coverId !== null &&
          (result.added.includes(coverId) || result.existing.includes(coverId))
        if (coverId && coverInAlbum) {
          try {
            await updateGalleryAlbum(album.id, { coverMediaId: coverId })
          } catch (coverError) {
            const message =
              coverError instanceof Error
                ? coverError.message
                : 'Failed to save.'
            setCreatedId(album.id)
            setError(
              `Added ${pluralize(result.added.length, 'photo')}, but the cover wasn’t changed: ${message}`
            )
            return
          }
        }
        if (coverId && !coverInAlbum) {
          const name = knownItems.get(coverId)?.subject?.name ?? 'Photo'
          setCreatedId(album.id)
          setNotice(
            `Added ${pluralize(result.added.length, 'photo')}, but ${name} wasn’t added, so the cover is unchanged.`
          )
          return
        }
      }
      if (albumId) onSaved(albumId)
      onOpenChange(false)
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Failed to save.'
      if (
        intent === 'add' &&
        album &&
        saveError instanceof GalleryAlbumAddError &&
        saveError.result !== null
      ) {
        if ((saveError.result.added.length ?? 0) > 0) {
          changedAlbumIdRef.current = album.id
        }
        // Reconcile the starred pick against the partial result, like the
        // create path: a star that made it into the album still becomes the
        // cover; one that did not leaves the album's cover unchanged, and
        // the notice says so next to the batch error.
        if (coverId !== null) {
          const starInPartialResult =
            saveError.result.added.includes(coverId) ||
            saveError.result.existing.includes(coverId)
          if (starInPartialResult) {
            try {
              await updateGalleryAlbum(album.id, { coverMediaId: coverId })
            } catch (coverError) {
              const coverMessage =
                coverError instanceof Error
                  ? coverError.message
                  : 'Failed to save.'
              setError(
                `Added ${pluralize(saveError.result.added.length, 'photo')}, but the cover wasn’t changed: ${coverMessage}`
              )
              return
            }
          } else {
            const name = knownItems.get(coverId)?.subject?.name ?? 'Photo'
            setNotice(
              `Added ${pluralize(saveError.result.added.length, 'photo')}, but ${name} wasn’t added, so the cover is unchanged.`
            )
          }
        }
      }
      setError(
        intent === 'create' && albumId
          ? `The album was created, but not everything was added: ${message}`
          : message
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (isSaving) return
    // The album exists already; closing is as good as opening it.
    if (!next) {
      const savedId = createdId ?? changedAlbumIdRef.current
      if (savedId) onSaved(savedId)
    }
    onOpenChange(next)
  }

  const picker = (
    <>
      {intent === 'create' && initialMediaIds?.length ? (
        <p className="text-muted-foreground text-xs">
          {initialMediaIds.length === 1
            ? 'The photo you chose is already selected. Choose more below, or create the album with just this one.'
            : `The ${formatCount(initialMediaIds.length)} photos you chose are already selected. Choose more below, or create the album with these.`}
        </p>
      ) : null}
      <GalleryAlbumPicker
        ownerId={ownerId}
        albumId={intent === 'add' ? album?.id : undefined}
        columns={showFields ? 4 : 5}
        selected={selected}
        onChange={setSelected}
        onFirstItemChange={setPickerCover}
        seedItems={initialItems}
        capacity={capacity}
        existingIds={existingMediaIds}
        disabled={isLocked}
        initialFilters={pickerInitialFilters}
        onItemsLoaded={handleItemsLoaded}
      />
    </>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[90dvh] flex-col gap-4 overflow-hidden p-4 sm:p-6',
          showPicker ? 'sm:max-w-4xl' : 'sm:max-w-xl'
        )}
        showCloseButton={!isSaving}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{TITLES[intent]}</DialogTitle>
          <DialogDescription className="sr-only">
            {intent === 'create'
              ? 'Name the album and choose its first photos. Nothing is saved until you create it.'
              : intent === 'edit'
                ? 'Change the album’s title, description and who can see it.'
                : 'Choose photos from your gallery to add. Nothing is saved until you add them.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div
            data-testid="scroll-container"
            className={cn(
              'min-h-0 flex-1 gap-5 overflow-y-auto p-1 -m-1',
              showFields && showPicker
                ? 'grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
                : 'block'
            )}
          >
            {showFields ? (
              <div className="space-y-4">
                <FormRow
                  stacked
                  className="p-0"
                  label="Title"
                  htmlFor="gallery-album-title"
                >
                  {() => (
                    <>
                      <Input
                        id="gallery-album-title"
                        ref={titleInputRef}
                        value={title}
                        maxLength={MAX_GALLERY_ALBUM_TITLE_LENGTH}
                        onChange={(event) => {
                          titleEdited.current = true
                          setTitle(event.target.value)
                          setTitleError(null)
                        }}
                        disabled={isLocked}
                        autoComplete="off"
                        aria-invalid={titleError ? true : undefined}
                        aria-describedby={
                          titleError ? 'gallery-album-title-error' : undefined
                        }
                      />
                      {titleError ? (
                        <p
                          id="gallery-album-title-error"
                          className="text-destructive-text mt-1.5 text-xs"
                        >
                          {titleError}
                        </p>
                      ) : null}
                    </>
                  )}
                </FormRow>
                <FormRow
                  stacked
                  className="p-0"
                  label={
                    <>
                      Description{' '}
                      <span className="text-muted-foreground font-normal">
                        (optional)
                      </span>
                    </>
                  }
                  htmlFor="gallery-album-description"
                >
                  <Textarea
                    id="gallery-album-description"
                    value={description}
                    maxLength={MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH}
                    rows={3}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={isLocked}
                  />
                </FormRow>
                <FormRow
                  stacked
                  className="p-0"
                  label="Visibility"
                  hint="A photo is only ever as visible as the post it came from."
                >
                  {({ labelledBy, describedBy }) => (
                    <RadioGroup
                      aria-labelledby={labelledBy}
                      aria-describedby={describedBy}
                      value={visibility}
                      onValueChange={(value) =>
                        setVisibility(value as GalleryAlbumVisibility)
                      }
                      disabled={isLocked}
                      className="gap-1.5"
                    >
                      {GALLERY_ALBUM_VISIBILITIES.map((value) => {
                        const { label, hint, icon } = VISIBILITY_COPY[value]
                        return (
                          <RadioCard
                            key={value}
                            id={`gallery-album-visibility-${value}`}
                            value={value}
                            title={label}
                            hint={hint}
                            icon={icon}
                            disabled={isLocked}
                          />
                        )
                      })}
                    </RadioGroup>
                  )}
                </FormRow>
                {intent === 'create' ? (
                  <FormRow
                    stacked
                    className="p-0"
                    label="Cover"
                    hint="Tap ☆ on a pick to change it"
                  >
                    {({ labelledBy, describedBy }) => (
                      <div
                        role="group"
                        aria-labelledby={labelledBy}
                        aria-describedby={describedBy}
                      >
                        <span
                          aria-hidden="true"
                          className="bg-muted/40 text-muted-foreground flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border"
                        >
                          {coverItem ? (
                            <GalleryAlbumThumb item={coverItem} />
                          ) : (
                            <Folder className="size-5" />
                          )}
                        </span>
                      </div>
                    )}
                  </FormRow>
                ) : null}
              </div>
            ) : null}

            {showPicker ? (
              <div className="min-w-0 space-y-2">
                {showSuggestions && suggestions ? (
                  <Tabs
                    value={tab}
                    onValueChange={(value) =>
                      setTab(value as GalleryAlbumPickerTab)
                    }
                    className="gap-3"
                  >
                    <TabsList
                      aria-label="Choose photos"
                      className="h-auto w-full justify-start gap-4 rounded-none border-b bg-transparent p-0"
                    >
                      {TABS.map(({ value, label, icon: Icon }) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className="data-[state=active]:border-b-primary dark:data-[state=active]:border-b-primary text-muted-foreground data-[state=active]:text-foreground dark:text-muted-foreground dark:data-[state=active]:text-foreground pointer-coarse:min-h-10 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pt-1 pb-2.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
                        >
                          {label}
                          {Icon ? (
                            <Icon className="size-3.5" aria-hidden="true" />
                          ) : null}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {/* Both panels stay mounted, so switching tabs keeps the
                        picker's filters and loaded pages. `forceMount` stops
                        Radix hiding the inactive one, so the class does. */}
                    <TabsContent
                      value="gallery"
                      forceMount
                      className="space-y-2 data-[state=inactive]:hidden"
                    >
                      {picker}
                    </TabsContent>
                    <TabsContent
                      value="suggestions"
                      forceMount
                      className="space-y-4 data-[state=inactive]:hidden"
                    >
                      <span
                        role="status"
                        aria-live="polite"
                        className="sr-only"
                      >
                        {toast?.message ?? ''}
                      </span>
                      <p className="text-muted-foreground text-xs">
                        {intent === 'create'
                          ? 'Using a suggestion adds its photos to the ones you’ve picked. Nothing is saved until you create the album.'
                          : 'Using a suggestion adds its photos to the ones you’ve picked. Photos already in this album are skipped. Nothing is saved until you add the photos.'}
                      </p>
                      {toast ? (
                        <AlbumUndoToast
                          toast={toast}
                          onDismiss={handleDismissToast}
                        />
                      ) : null}
                      <GalleryAlbumSuggestionList
                        state={suggestions.state}
                        onRetry={suggestions.reload}
                        activeId={activeSuggestion?.id ?? null}
                        onUse={handleUseSuggestion}
                        disabled={isLocked}
                        existingIds={
                          intent === 'add' ? existingMediaIds : undefined
                        }
                      />
                      {activeSuggestion ? (
                        <GalleryAlbumSuggestionReview
                          key={`${activeSuggestion.id}:${reviewRun}`}
                          suggestion={activeSuggestion}
                          selected={selected}
                          onChange={setSelected}
                          onItemsLoaded={handleItemsLoaded}
                          capacity={capacity}
                          disabled={isLocked}
                          existingIds={
                            intent === 'add' ? existingMediaIds : undefined
                          }
                        />
                      ) : null}
                    </TabsContent>
                  </Tabs>
                ) : (
                  <>
                    {showFields ? (
                      <p className="text-sm leading-5 font-medium">
                        From gallery
                      </p>
                    ) : null}
                    {picker}
                  </>
                )}
              </div>
            ) : null}
          </div>

          {showPicker ? (
            <GalleryAlbumPicksStrip
              selected={selected}
              items={knownItems}
              starId={starId}
              intent={intent === 'add' ? 'add' : 'create'}
              room={room}
              onRemove={handleRemovePick}
              onSetCover={setCoverId}
              onClear={handleClearPicks}
              disabled={isLocked}
            />
          ) : null}

          {overCapCount > 0 ? (
            <p role="alert" className="text-destructive-text text-xs">
              {`Albums hold up to ${formatCount(MAX_GALLERY_ALBUM_ITEMS)} photos. Remove ${formatCount(overCapCount)} to continue.`}
            </p>
          ) : null}
          {photosError ? (
            <p role="alert" className="text-destructive-text text-xs">
              {photosError}
            </p>
          ) : null}
          {error ? <Alert title={error} /> : null}
          {notice ? <Alert tone="warning" title={notice} /> : null}

          {/* This content is `p-4` on phones (`sm:p-6` above), so the separated
              footer's bleed matches each. */}
          <DialogFooter
            separated
            className="-mx-4 -mb-4 flex-col px-4 sm:-mx-6 sm:-mb-6 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            {showPicker ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="album-selection-count"
              >
                {intent === 'add' ? (
                  <>
                    <span className="hidden sm:inline">
                      {starId && starName
                        ? `★ ${starName} becomes the cover`
                        : ''}
                    </span>
                    <span className="sm:hidden">
                      Room for {formatCount(room)}
                    </span>
                  </>
                ) : (
                  `${formatCount(selected.length)} selected`
                )}
              </p>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSaving}
              >
                {createdId ? 'Close' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                disabled={isSaving || (createdId === null && overCapCount > 0)}
              >
                {createdId ? (
                  'Open album'
                ) : isSaving ? (
                  'Saving…'
                ) : intent === 'add' && selected.length > 0 ? (
                  <>
                    <span className="hidden sm:inline">
                      Add {pluralize(selected.length, 'photo')}
                    </span>
                    <span className="sm:hidden">
                      Add {formatCount(selected.length)}
                    </span>
                  </>
                ) : (
                  SUBMIT_LABELS[intent]
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

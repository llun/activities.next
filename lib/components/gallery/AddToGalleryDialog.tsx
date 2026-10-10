'use client'

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  addMediaToGallery,
  deleteUnpostedMedia,
  getGallerySettings,
  getMedia,
  suggestMediaSubjects,
  uploadAttachment
} from '@/lib/client'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import {
  MediaDetailsDialog,
  type MediaDetailsDialogItem
} from '@/lib/components/media-details/media-details-dialog'
import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import { MAX_HEIGHT, MAX_WIDTH } from '@/lib/services/medias/constants'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import { extractVideoPoster } from '@/lib/utils/extractVideoPoster'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { resizeImage } from '@/lib/utils/resizeImage'

/** How many files go up at once. */
const UPLOAD_CONCURRENCY = 3
/** How many subject suggestions are asked for at once (the composer's limit). */
const SUGGESTION_CONCURRENCY = 2

interface Entry {
  /** A temporary id, until the upload gives the media's own. */
  key: string
  file: File
  /** A blob for the preview while the file goes up. */
  previewUrl: string
  previewPosterUrl?: string
  state: 'uploading' | 'done' | 'failed'
  error?: string
  /** Set when the upload finished. */
  media?: {
    id: string
    url: string
    posterUrl?: string
    mediaType: string
    width: number
    height: number
    description: string
  }
  details: MediaDetailsEntity | null
}

interface Props {
  /** The files to add, already limited to what the page takes. */
  files: File[]
  /** The dialog is gone: photos added, or the upload cancelled. */
  onClose: () => void
  /** The photos are in the gallery now, newest first. */
  onAdded: (mediaIds: string[]) => void
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

/**
 * Add to gallery: the media details dialog over files that upload as soon as
 * it opens (the way the composer uploads on attach). Each file's date, camera
 * and place are read by the server when it arrives, and subject suggestions
 * follow as they do in the composer. Nothing is in the gallery until Add: then
 * every photo's details are saved and the photos are confirmed (only the owner
 * can see them until they post them). Cancelling deletes what was uploaded.
 */
export const AddToGalleryDialog: FC<Props> = ({ files, onClose, onAdded }) => {
  const { maxMediaFileSize } = useInstanceLimits()
  const [entries, setEntries] = useState<Entry[]>([])
  const [settings, setSettings] = useState<GallerySettingsEntity | null>(null)
  const [suggestionsPending, setSuggestionsPending] = useState<
    Record<string, true>
  >({})

  const cancelledRef = useRef(false)
  const startedRef = useRef(false)
  const entriesRef = useRef<Entry[]>([])
  const settingsPromiseRef = useRef<Promise<GallerySettingsEntity | null>>(
    Promise.resolve(null)
  )
  const suggestionQueue = useRef<string[]>([])
  const suggestionsActive = useRef(0)

  const update = useCallback((key: string, patch: Partial<Entry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, ...patch } : entry
      )
    )
  }, [])

  const releasePreview = (
    entry: Pick<Entry, 'previewUrl' | 'previewPosterUrl'>
  ) => {
    URL.revokeObjectURL(entry.previewUrl)
    if (entry.previewPosterUrl) URL.revokeObjectURL(entry.previewPosterUrl)
  }

  const runSuggestion = useCallback(async (mediaId: string) => {
    try {
      const suggestions = await suggestMediaSubjects(mediaId)
      if (cancelledRef.current) return
      setEntries((current) =>
        current.map((entry) =>
          entry.media?.id === mediaId && entry.details
            ? {
                ...entry,
                details: { ...entry.details, subjectSuggestions: suggestions }
              }
            : entry
        )
      )
    } catch {
      // Suggestions are an aid: the dialog can ask again.
    } finally {
      setSuggestionsPending((current) => {
        const { [mediaId]: _done, ...rest } = current
        return rest
      })
    }
  }, [])

  const pumpSuggestions = useCallback(() => {
    while (
      suggestionsActive.current < SUGGESTION_CONCURRENCY &&
      suggestionQueue.current.length > 0
    ) {
      const mediaId = suggestionQueue.current.shift()
      if (!mediaId) break
      suggestionsActive.current += 1
      void runSuggestion(mediaId).finally(() => {
        suggestionsActive.current -= 1
        pumpSuggestions()
      })
    }
  }, [runSuggestion])

  const requestSuggestions = useCallback(
    async (mediaId: string) => {
      const loaded = await settingsPromiseRef.current
      if (
        cancelledRef.current ||
        !loaded?.subjectSuggestionsAvailable ||
        loaded.subjectSuggestionMode !== 'model'
      ) {
        return
      }
      setSuggestionsPending((current) => ({ ...current, [mediaId]: true }))
      suggestionQueue.current.push(mediaId)
      pumpSuggestions()
    },
    [pumpSuggestions]
  )

  const upload = useCallback(
    async (entry: Entry) => {
      try {
        let posterFile: File | undefined
        if (entry.file.type.startsWith('video')) {
          posterFile = (await extractVideoPoster(entry.file)) ?? undefined
          if (posterFile && !cancelledRef.current) {
            update(entry.key, {
              previewPosterUrl: URL.createObjectURL(posterFile)
            })
          }
        }
        const prepared = await resizeImage(entry.file, MAX_WIDTH, MAX_HEIGHT)
        if (prepared.size > maxMediaFileSize) {
          throw new Error(
            `Larger than the ${formatFileSize(maxMediaFileSize)} upload limit`
          )
        }
        if (cancelledRef.current) return
        const uploaded = posterFile
          ? await uploadAttachment(prepared, posterFile)
          : await uploadAttachment(prepared)
        if (!uploaded) throw new Error('The server rejected the upload')
        if (cancelledRef.current) {
          // Cancelled while it went up: the server copy is an orphan.
          deleteUnpostedMedia(uploaded.id).catch(() => undefined)
          return
        }
        update(entry.key, {
          state: 'done',
          media: {
            id: uploaded.id,
            url: uploaded.url,
            posterUrl: uploaded.posterUrl,
            mediaType: uploaded.mediaType,
            width: uploaded.width,
            height: uploaded.height,
            description: uploaded.name ?? ''
          }
        })
        try {
          const media = await getMedia(uploaded.id)
          if (!cancelledRef.current && media.details) {
            const details = media.details
            setEntries((current) =>
              current.map((candidate) =>
                candidate.key === entry.key
                  ? { ...candidate, details: candidate.details ?? details }
                  : candidate
              )
            )
          }
        } catch {
          // The dialog still works; fields the file would have filled in stay
          // empty, and only what the owner changes is sent.
        }
        void requestSuggestions(uploaded.id)
      } catch (error) {
        if (cancelledRef.current) return
        update(entry.key, {
          state: 'failed',
          error: errorMessage(error, 'Upload failed')
        })
      }
    },
    [maxMediaFileSize, requestSuggestions, update]
  )

  useEffect(() => {
    cancelledRef.current = false
    if (startedRef.current) return
    startedRef.current = true
    settingsPromiseRef.current = getGallerySettings().then(
      (result) => {
        setSettings(result)
        return result
      },
      () => null
    )
    const initial: Entry[] = files.map((file) => ({
      key: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      state: 'uploading',
      details: null
    }))
    entriesRef.current = initial
    setEntries(initial)
    // A few at a time: the rest wait their turn.
    let next = 0
    const worker = async () => {
      while (!cancelledRef.current && next < initial.length) {
        await upload(initial[next++])
      }
    }
    for (let i = 0; i < Math.min(UPLOAD_CONCURRENCY, initial.length); i += 1) {
      void worker()
    }
    // The previews are released when the dialog finishes (`finish`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const finish = useCallback(() => {
    for (const entry of entriesRef.current) releasePreview(entry)
  }, [])

  const items = useMemo<MediaDetailsDialogItem[]>(
    () =>
      entries.map((entry): MediaDetailsDialogItem => {
        const done = entry.state === 'done' && entry.media
        return {
          id: done ? entry.media!.id : entry.key,
          mediaType: done ? entry.media!.mediaType : entry.file.type,
          url: done ? entry.media!.url : entry.previewUrl,
          posterUrl: done
            ? entry.media!.posterUrl
            : (entry.previewPosterUrl ?? undefined),
          width: done ? entry.media!.width : 0,
          height: done ? entry.media!.height : 0,
          description: done ? entry.media!.description : '',
          decorative: false,
          details: entry.details,
          upload:
            entry.state === 'done'
              ? undefined
              : {
                  state: entry.state === 'failed' ? 'failed' : 'uploading',
                  error: entry.error
                }
        }
      }),
    [entries]
  )

  const handleDiscard = () => {
    cancelledRef.current = true
    const uploaded = entriesRef.current.flatMap((entry) =>
      entry.media ? [entry.media.id] : []
    )
    finish()
    // Best effort: what stays behind is an unposted upload nobody can see.
    for (const id of uploaded) deleteUnpostedMedia(id).catch(() => undefined)
    onClose()
  }

  const handleAdd = async (mediaIds: string[]) => {
    const added = await addMediaToGallery(mediaIds)
    onAdded(added)
  }

  const handleDetailsRefreshed = useCallback(
    (
      id: string,
      patch: Partial<MediaDetailsEntity>,
      value: MediaDetailsEntity
    ) =>
      setEntries((current) =>
        current.map((entry) =>
          entry.media?.id === id
            ? {
                ...entry,
                details: entry.details ? { ...entry.details, ...patch } : value
              }
            : entry
        )
      ),
    []
  )

  const firstId = items[0]?.id
  if (!firstId) return null

  return (
    <MediaDetailsDialog
      context="add"
      items={items}
      initialId={firstId}
      settings={settings}
      suggestionsPending={suggestionsPending}
      onDetailsRefreshed={handleDetailsRefreshed}
      onSaved={() => undefined}
      onAdd={handleAdd}
      onDiscard={handleDiscard}
      onRemoveItem={(id) => {
        const gone = entriesRef.current.find((entry) => entry.key === id)
        if (gone) releasePreview(gone)
        setEntries((current) => current.filter((entry) => entry.key !== id))
      }}
      onClose={() => {
        finish()
        onClose()
      }}
    />
  )
}

'use client'

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import type { AlbumToast } from '@/lib/components/gallery/useMediaAlbums'
import { UPLOADED_DAY_PREFIX } from '@/lib/services/gallery/galleryEntities'
import type {
  GalleryDayKey,
  GalleryItemEntity
} from '@/lib/services/gallery/galleryEntities'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'
import {
  MAX_GALLERY_ALBUM_ITEMS,
  MAX_GALLERY_IDS_OFFSET
} from '@/lib/types/database/galleryAlbums'

import { pluralize } from './galleryCategories'
import { formatDayToastPhrase, getGalleryDayKey } from './galleryDayGroups'
import { describeRangeResult } from './gallerySelectionKeys'

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

// An upload day's phrase ("uploaded Sat 24 Oct 2026") reads badly after a
// bare preposition, so a message that prefixes one spells its own lead-in
// for uploaded keys: "… from Sat 4 Oct 2025" for a dated day, "… among
// photos uploaded Sat 24 Oct 2026" for an upload day.
const formatDayMessagePhrase = (leadIn: string, key: GalleryDayKey): string =>
  key.startsWith(UPLOADED_DAY_PREFIX)
    ? `${leadIn} among photos ${formatDayToastPhrase(key)}`
    : `${leadIn} ${formatDayToastPhrase(key)}`

const formatNothingNewPhrase = (key: GalleryDayKey): string =>
  formatDayMessagePhrase('Nothing new to select', key)

// A stable identity for a query snapshot: JSON of its fields in a fixed
// order, so equal snapshots always key the same resume entry whatever
// order the host built their object in.
const snapshotKey = (value: unknown): string => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, field]) => `${JSON.stringify(name)}:${snapshotKey(field)}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

/**
 * Resume state for one day's background item hydration under one query.
 * The hook seeds `from` with the cursor where that day's last hydration
 * under the same query snapshot stopped at the host's page bound, so a
 * retry continues from there instead of page 1; a host that stops at the
 * bound again sets `stoppedAt` to its cursor, and one that finishes the
 * read leaves it unset (clearing that query's resume point).
 */
export interface GalleryHydrationResume {
  from?: string
  stoppedAt?: string
}

interface UseDaySelectionInput<Q = unknown> {
  selected: string[]
  onChange: Dispatch<SetStateAction<string[]>>
  sort: GalleryMediaSort
  /** Already in the album: never (re)selected. */
  existingIds?: ReadonlySet<string>
  /** Null: no capacity (All media). */
  room: number | null
  /** Changes only when the account owning the host changes. */
  ownerKey?: string
  /** Saving locks selection and invalidates an in-flight Select day read. */
  disabled?: boolean
  fetchIds: (
    dayKey: GalleryDayKey,
    limit: number,
    offset?: number
  ) => Promise<string[]>
  /** Load the missing selected items from the host's current filtered list. */
  loadItems?: (
    dayKey: GalleryDayKey,
    mediaIds: string[],
    isStale: () => boolean,
    signal: AbortSignal,
    resume?: GalleryHydrationResume,
    /**
     * The sort the day key was learned under. A retry after a sort change
     * hydrates with it, not the host's current sort, so the read's day_key
     * always matches its sort.
     */
    sort?: GalleryMediaSort,
    /**
     * The host query the day's hydration started under (sort, filters,
     * category, show — whatever the host pages its list with). A retry
     * after a filter or sort change hydrates with it, not the host's
     * current query, so the read never moves to a query the picked ids do
     * not match.
     */
    query?: Q
  ) => Promise<GalleryItemEntity[]>
  /**
   * Snapshots the host's query context when a day's hydration starts; the
   * snapshot keys the day's resume entry and is remembered per picked id,
   * so a later Retry after a filter or sort change pages the query the id
   * was picked under, never the host's current query.
   */
  querySnapshot?: () => Q
  /** Let the host add hydrated items to its own entity cache. */
  onItemsLoaded?: (items: GalleryItemEntity[]) => void
  /**
   * Changes when the host's context changes under the selection (sort,
   * filters, selection mode): pending id reads are dropped, the learned
   * day-of entries are cleared and the toast, error and announcement go.
   * Background item hydration survives these query-only changes.
   */
  resetKey?: string
}

const abortHydrations = (controllers: Set<AbortController>) => {
  for (const controller of controllers) controller.abort()
  controllers.clear()
}

// All media has no album cap, so a whole day can be arbitrarily big. One
// Select day reads at most 25 pages (50,000 ids) from where the day's last
// read stopped and says so when the page bound, not the day, ends it. The
// saved offset may sit past the route maximum as an exhausted marker.
const MAX_WHOLE_DAY_PAGES = 25

/**
 * Select day / Deselect day for one grid: learns the day of every loaded
 * tile, fetches a day's ids on demand and keeps the toast, the live-region
 * message and the failure the host renders.
 */
export const useDaySelection = <Q = unknown>({
  selected,
  onChange,
  sort,
  existingIds,
  room,
  fetchIds,
  loadItems,
  querySnapshot,
  onItemsLoaded,
  resetKey,
  ownerKey,
  disabled = false
}: UseDaySelectionInput<Q>) => {
  const [toast, setToast] = useState<AlbumToast | null>(null)
  const [busyKey, setBusyKey] = useState<GalleryDayKey | null>(null)
  // The ids fetched so far for the busy key's read (its progress label).
  const [busyCount, setBusyCount] = useState(0)
  // Bumped by every noteItems: pickedInDay reads the day map through a
  // ref, so without a new identity per noting the hosts' memoised day
  // headers would keep the counts they computed before the items were
  // noted (after a resetKey change, before the re-noting, that is zero).
  const [notedVersion, setNotedVersion] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The fetch is async: read the selection through a ref, not the closure.
  const selectedRef = useRef(selected)
  const onChangeRef = useRef<Dispatch<SetStateAction<string[]>>>(onChange)
  const existingIdsRef = useRef(existingIds)
  const fetchIdsRef = useRef(fetchIds)
  const loadItemsRef = useRef(loadItems)
  const querySnapshotRef = useRef(querySnapshot)
  const onItemsLoadedRef = useRef(onItemsLoaded)
  const roomRef = useRef(room)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const sortRef = useRef(sort)
  sortRef.current = sort
  const ownerKeyRef = useRef(ownerKey)
  const ownerGenerationRef = useRef(0)
  if (ownerKeyRef.current !== ownerKey) {
    ownerKeyRef.current = ownerKey
    ownerGenerationRef.current += 1
  }
  const seenItemsRef = useRef(new Set<string>())
  // mediaId -> the day it is shown under.
  const dayOf = useRef(new Map<string, GalleryDayKey>())
  // mediaId -> the sort its day was learned under (the day key's other half:
  // a dated key belongs to a date sort, an `uploaded:` key to any).
  const sortOf = useRef(new Map<string, GalleryMediaSort>())
  // Selected ids keep their original day and sort so a failed hydration can
  // be retried after a filter or sort reset clears the current query's day
  // map.
  const selectedDayOfRef = useRef(new Map<string, GalleryDayKey>())
  const selectedSortOfRef = useRef(new Map<string, GalleryMediaSort>())
  // Bumped on every resetKey change; a fetch started before it is stale.
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const hydrationControllersRef = useRef(new Set<AbortController>())
  // `${sort}|${day key}|${query snapshot}` -> the cursor where that day's
  // background hydration under that query stopped at the host's page
  // bound; the next hydration of that day under the same query continues
  // from it. Photos selected later under a different filter get their own
  // entry and start at page 1.
  const hydrationCursorsRef = useRef(new Map<string, string>())
  // mediaId -> the query snapshot its hydration runs under, remembered
  // when the hydration starts so a Retry after a filter or sort change
  // replays the query the id was picked under.
  const hydrationQueryOfRef = useRef(new Map<string, Q>())
  // Day key -> the offset where an All media whole-day read stopped at the
  // page bound; the next Select day of that day continues from it instead
  // of re-reading from offset 0.
  const wholeDayOffsetsRef = useRef(new Map<GalleryDayKey, number>())
  // Bumped whenever the whole-day offsets are cleared while a read may
  // still be in flight: a read that settles with a changed generation
  // must not save its continuation offset, because the ids before it may
  // have left the selection while it was paging.
  const wholeDayGenerationRef = useRef(0)
  // The selection as of the last render: any id missing from the current
  // one means ids left the selection, which breaks the saved offsets'
  // invariant (the ids before a saved offset are still selected).
  const previousSelectedRef = useRef<ReadonlySet<string> | null>(null)
  const busyRequestRef = useRef<{
    key: GalleryDayKey
    generation: number
  } | null>(null)
  // The last failed selectDay or deselectDay, for retry.
  const lastFailedRef = useRef<{
    key: GalleryDayKey
    take: number
    kind: 'select' | 'deselect'
  } | null>(null)
  const toastId = useRef(0)

  // Layout effects, not passive ones: an Undo or a click right after a
  // commit must already see this render's selection and room.
  useLayoutEffect(() => {
    selectedRef.current = selected
    const selectedSet = new Set(selected)
    // A saved whole-day offset assumes the ids before it are still
    // selected. Any id leaving the selection (a Select day or Deselect day
    // Undo, Clear, a manual unpick) breaks that, so the saved offsets go.
    const previous = previousSelectedRef.current
    if (previous !== null) {
      for (const id of previous) {
        if (!selectedSet.has(id)) {
          wholeDayOffsetsRef.current.clear()
          wholeDayGenerationRef.current += 1
          break
        }
      }
    }
    previousSelectedRef.current = selectedSet
    for (const id of selected) {
      const key = dayOf.current.get(id)
      if (key !== undefined) {
        selectedDayOfRef.current.set(id, key)
        const sort = sortOf.current.get(id)
        if (sort !== undefined) selectedSortOfRef.current.set(id, sort)
      }
    }
    for (const id of selectedDayOfRef.current.keys()) {
      if (!selectedSet.has(id)) selectedDayOfRef.current.delete(id)
    }
    for (const id of selectedSortOfRef.current.keys()) {
      if (!selectedSet.has(id)) selectedSortOfRef.current.delete(id)
    }
    for (const id of hydrationQueryOfRef.current.keys()) {
      if (!selectedSet.has(id)) hydrationQueryOfRef.current.delete(id)
    }
  }, [selected])
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    existingIdsRef.current = existingIds
  }, [existingIds])
  useEffect(() => {
    fetchIdsRef.current = fetchIds
  }, [fetchIds])
  useEffect(() => {
    loadItemsRef.current = loadItems
  }, [loadItems])
  useEffect(() => {
    querySnapshotRef.current = querySnapshot
  }, [querySnapshot])
  useEffect(() => {
    onItemsLoadedRef.current = onItemsLoaded
  }, [onItemsLoaded])
  useLayoutEffect(() => {
    roomRef.current = room
  }, [room])

  useEffect(() => {
    if (resetKey === undefined) return
    generationRef.current += 1
    busyRequestRef.current = null
    lastFailedRef.current = null
    setBusyKey(null)
    setBusyCount(0)
    setToast(null)
    setError(null)
    setAnnouncement('')
    // Only days learned under the current context count: entries noted or
    // fetched under the previous query do not match the active filters, so
    // the hosts re-note their items as the pages of the new query load.
    dayOf.current.clear()
    sortOf.current.clear()
    wholeDayOffsetsRef.current.clear()
  }, [resetKey])

  useEffect(() => {
    if (!disabled) return
    generationRef.current += 1
    busyRequestRef.current = null
    lastFailedRef.current = null
    setBusyKey(null)
    setBusyCount(0)
  }, [disabled])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      busyRequestRef.current = null
      hydrationCursorsRef.current.clear()
      hydrationQueryOfRef.current.clear()
      wholeDayOffsetsRef.current.clear()
      abortHydrations(hydrationControllersRef.current)
    }
  }, [])

  useEffect(() => {
    hydrationCursorsRef.current.clear()
    hydrationQueryOfRef.current.clear()
    wholeDayOffsetsRef.current.clear()
    abortHydrations(hydrationControllersRef.current)
  }, [ownerKey])

  /** Learn the day of loaded tiles. */
  const noteItems = useCallback(
    (items: GalleryItemEntity[]) => {
      for (const item of items) {
        seenItemsRef.current.add(item.mediaId)
        const key = getGalleryDayKey(item, sort)
        if (key !== null) {
          dayOf.current.set(item.mediaId, key)
          sortOf.current.set(item.mediaId, sort)
          if (selectedRef.current.includes(item.mediaId)) {
            selectedDayOfRef.current.set(item.mediaId, key)
            selectedSortOfRef.current.set(item.mediaId, sort)
          }
        }
      }
      // A new pickedInDay identity per noting, so every host that keys its
      // day headers on it recomputes them from the tiles just noted.
      setNotedVersion((version) => version + 1)
    },
    [sort]
  )

  // shortcut: After a filter or sort change this counts only the tiles the
  // new query has loaded again, so a day header's picked count can sit below
  // the selection bar's until the day's pages reload; a Select N more that
  // then finds nothing new answers "Nothing new to select".
  const pickedInDay = useCallback(
    (key: GalleryDayKey): number =>
      selected.reduce(
        (count, id) => (dayOf.current.get(id) === key ? count + 1 : count),
        0
      ),
    [selected, notedVersion]
  )

  const hydrateItems = useCallback(
    (
      key: GalleryDayKey,
      missing: string[],
      ownerGeneration: number,
      sort: GalleryMediaSort,
      query?: Q
    ) => {
      const load = loadItemsRef.current
      const pending = missing.filter((id) => !seenItemsRef.current.has(id))
      if (!load || pending.length === 0) return

      const controller = new AbortController()
      hydrationControllersRef.current.add(controller)
      // A previous hydration of this day under this query stopped at the
      // host's page bound: continue from where it left off instead of
      // re-reading from page 1. Resume entries are per sort and per query
      // snapshot: a read under one sort or filter cannot continue from
      // where another's paging stopped, so photos selected later under a
      // different filter start at page 1 with their own entry.
      const resumeKey = `${sort}|${key}|${snapshotKey(query)}`
      const resume: GalleryHydrationResume = {}
      const savedCursor = hydrationCursorsRef.current.get(resumeKey)
      if (savedCursor !== undefined) resume.from = savedCursor
      // Remember the query each pending id hydrates under, so a later
      // Retry pages this query — and resumes this query's own entry —
      // even after the host's query has changed.
      if (query !== undefined) {
        for (const id of pending) hydrationQueryOfRef.current.set(id, query)
      }
      const isStale = () =>
        controller.signal.aborted ||
        !mountedRef.current ||
        ownerGenerationRef.current !== ownerGeneration
      void (async () => {
        try {
          const loadedItems = await load(
            key,
            pending,
            isStale,
            controller.signal,
            resume,
            sort,
            query
          )
          if (isStale()) return
          // A read the page bound stopped leaves the cursor to continue
          // from; a finished read clears the query's resume point.
          if (resume.stoppedAt !== undefined) {
            hydrationCursorsRef.current.set(resumeKey, resume.stoppedAt)
          } else {
            hydrationCursorsRef.current.delete(resumeKey)
          }
          const pendingSet = new Set(pending)
          const relevantItems = loadedItems.filter((item) =>
            pendingSet.has(item.mediaId)
          )
          for (const item of relevantItems) {
            seenItemsRef.current.add(item.mediaId)
          }
          if (relevantItems.length > 0) {
            onItemsLoadedRef.current?.(relevantItems)
          }
        } catch {
          // Keep the selection when its optional entity hydration fails.
        } finally {
          hydrationControllersRef.current.delete(controller)
        }
      })()
    },
    []
  )

  // Reads a whole day's ids for All media (no album cap): pages of
  // MAX_GALLERY_ALBUM_ITEMS from `readStart`, at most MAX_WHOLE_DAY_PAGES
  // pages, never requesting an offset past the route's maximum. Null when
  // the context changed mid-read; `hitPageBound` is true when a bound, not
  // the day, may have ended the read, and `nextOffset` is where a next read
  // of the day continues from.
  const readWholeDayIds = useCallback(
    async (
      key: GalleryDayKey,
      generation: number,
      ownerGeneration: number,
      readStart: number
    ): Promise<{
      ids: string[]
      hitPageBound: boolean
      nextOffset: number
    } | null> => {
      const isStale = () =>
        generationRef.current !== generation ||
        disabledRef.current ||
        !mountedRef.current ||
        ownerGenerationRef.current !== ownerGeneration
      let ids = await fetchIdsRef.current(
        key,
        MAX_GALLERY_ALBUM_ITEMS,
        readStart
      )
      if (isStale()) return null
      setBusyCount(ids.length)
      let offset = readStart + MAX_GALLERY_ALBUM_ITEMS
      let pageLength = ids.length
      let pages = 1
      while (
        pageLength === MAX_GALLERY_ALBUM_ITEMS &&
        pages < MAX_WHOLE_DAY_PAGES &&
        offset <= MAX_GALLERY_IDS_OFFSET
      ) {
        const page = await fetchIdsRef.current(
          key,
          MAX_GALLERY_ALBUM_ITEMS,
          offset
        )
        if (isStale()) return null
        ids = [...ids, ...page]
        setBusyCount(ids.length)
        pageLength = page.length
        offset += MAX_GALLERY_ALBUM_ITEMS
        pages += 1
      }
      return {
        ids,
        hitPageBound: pageLength === MAX_GALLERY_ALBUM_ITEMS,
        nextOffset: offset
      }
    },
    []
  )

  const selectDay = useCallback(
    async (key: GalleryDayKey, take: number) => {
      if (disabledRef.current || busyRequestRef.current !== null) return
      const generation = generationRef.current
      const ownerGeneration = ownerGenerationRef.current
      const request = { key, generation }
      busyRequestRef.current = request
      setBusyKey(key)
      setBusyCount(0)
      setError(null)
      try {
        const roomAtStart = roomRef.current
        const readStart =
          roomAtStart === null ? (wholeDayOffsetsRef.current.get(key) ?? 0) : 0
        if (roomAtStart === null && readStart > MAX_GALLERY_IDS_OFFSET) {
          toastId.current += 1
          setToast({
            id: toastId.current,
            message: formatDayMessagePhrase(
              'Nothing more can be selected in one go',
              key
            ),
            undo: null
          })
          setAnnouncement('Nothing more can be selected in one go')
          return
        }
        const limit = Math.min(
          take + selectedRef.current.length,
          MAX_GALLERY_ALBUM_ITEMS
        )
        // A whole-day read the page bound stopped last time continues from
        // the offset it saved; the ids before it are already selected.
        let ids: string[]
        // True when a bound, not the day, ended the whole-day read.
        let hitPageBound = false
        if (roomAtStart === null) {
          // The generation the offsets are valid under: an Undo, Clear or
          // unpick while the read pages clears them and bumps it, so the
          // settling read must not save its continuation offset.
          const wholeDayGeneration = wholeDayGenerationRef.current
          const read = await readWholeDayIds(
            key,
            generation,
            ownerGeneration,
            readStart
          )
          if (read === null) return
          ids = read.ids
          hitPageBound = read.hitPageBound
          if (wholeDayGenerationRef.current !== wholeDayGeneration) {
            // The selection lost ids while the read was in flight, so the
            // ids before the continuation offset are no longer all
            // selected: the day restarts from offset 0 next time.
            wholeDayOffsetsRef.current.delete(key)
          } else if (hitPageBound) {
            // A full last page means the day may hold more than was read.
            // Save the next offset unchanged; when it passes the route
            // maximum the next click treats it as exhausted instead of
            // repeating a page.
            wholeDayOffsetsRef.current.set(key, read.nextOffset)
          } else {
            wholeDayOffsetsRef.current.delete(key)
          }
        } else {
          ids = await fetchIdsRef.current(key, limit)
          if (
            generationRef.current !== generation ||
            disabledRef.current ||
            !mountedRef.current ||
            ownerGenerationRef.current !== ownerGeneration
          )
            return
          setBusyCount(ids.length)
        }
        const selectedSet = new Set(selectedRef.current)
        const candidates = ids.filter(
          (id) => !selectedSet.has(id) && !existingIdsRef.current?.has(id)
        )
        const roomNow = roomRef.current
        const allowed =
          roomNow === null ? take : Math.min(take, Math.max(roomNow, 0))
        const additions = candidates.slice(0, allowed)
        for (const id of ids) {
          dayOf.current.set(id, key)
          sortOf.current.set(id, sortRef.current)
        }
        if (additions.length === 0) {
          toastId.current += 1
          setToast({
            id: toastId.current,
            message: roomNow === 0 ? 'Album full' : formatNothingNewPhrase(key),
            undo: null
          })
          setAnnouncement(
            roomNow === 0
              ? 'The album is full'
              : describeRangeResult({ added: [], removed: [], hitRoom: false })
          )
          return
        }
        const addedSet = new Set(additions)
        onChangeRef.current((current) => {
          const currentSet = new Set(current)
          return [...current, ...additions.filter((id) => !currentSet.has(id))]
        })
        // The add filled the album: the take was the room left (rule 4 of
        // getSelectDayAction) and no further photo fits.
        const hitRoom = roomNow !== null && additions.length === roomNow
        // The page bound stopped the read: the toast says the selection
        // covers the day's photos up to where the read ended (this click's
        // pages plus the ones a saved offset skipped), not the whole day.
        const selectedPhrase = hitPageBound
          ? `Selected the first ${pluralize(readStart + ids.length, 'photo')}`
          : `Selected ${pluralize(additions.length, 'photo')}`
        toastId.current += 1
        setToast({
          id: toastId.current,
          message: `${selectedPhrase} ${formatDayToastPhrase(key)}${
            hitRoom ? ' · the album is full' : ''
          }`,
          undo: () => {
            onChangeRef.current((current) =>
              current.filter((id) => !addedSet.has(id))
            )
          }
        })
        setAnnouncement(
          describeRangeResult({ added: additions, removed: [], hitRoom })
        )

        const missing = additions.filter((id) => !seenItemsRef.current.has(id))
        if (busyRequestRef.current === request) {
          busyRequestRef.current = null
          setBusyKey(null)
          setBusyCount(0)
        }
        hydrateItems(
          key,
          missing,
          ownerGeneration,
          sortRef.current,
          querySnapshotRef.current?.()
        )
      } catch (cause) {
        if (generationRef.current !== generation || disabledRef.current) return
        lastFailedRef.current = { key, take, kind: 'select' }
        setError(errorText(cause, 'Could not select the day'))
      } finally {
        if (
          generationRef.current === generation &&
          busyRequestRef.current === request
        ) {
          busyRequestRef.current = null
          setBusyKey(null)
          setBusyCount(0)
        }
      }
    },
    [hydrateItems, readWholeDayIds]
  )

  const retryHydration = useCallback(() => {
    if (!loadItemsRef.current) return
    // One group per day key, sort and query snapshot, hydrated with the
    // context its picks were selected under: a later sort or filter change
    // must not send the saved day key with the host's new sort (the route
    // answers 422 on a mismatch) or page a query the picked ids do not
    // match, and each group resumes only its own query's entry.
    const byDay = new Map<
      string,
      { key: GalleryDayKey; ids: string[]; sort: GalleryMediaSort; query?: Q }
    >()
    for (const id of selectedRef.current) {
      if (seenItemsRef.current.has(id)) continue
      const key =
        selectedDayOfRef.current.get(id) ?? dayOf.current.get(id) ?? null
      if (key === null) continue
      const sort = selectedSortOfRef.current.get(id) ?? sortRef.current
      const query =
        hydrationQueryOfRef.current.get(id) ?? querySnapshotRef.current?.()
      const groupId = `${key}|${sort}|${snapshotKey(query)}`
      const group = byDay.get(groupId) ?? { key, ids: [], sort, query }
      group.ids.push(id)
      byDay.set(groupId, group)
    }
    for (const group of byDay.values()) {
      hydrateItems(
        group.key,
        group.ids,
        ownerGenerationRef.current,
        group.sort,
        group.query
      )
    }
  }, [hydrateItems])

  // The day's selected photos are not all loaded after a filter or sort
  // change (the day map holds only the tiles the new query re-noted), so
  // Deselect day reads the day's ids from the server — the same read Select
  // day uses — and removes those from the selection.
  const deselectDay = useCallback(
    async (key: GalleryDayKey) => {
      if (disabledRef.current || busyRequestRef.current !== null) return
      const generation = generationRef.current
      const ownerGeneration = ownerGenerationRef.current
      const request = { key, generation }
      busyRequestRef.current = request
      setBusyKey(key)
      setBusyCount(0)
      setError(null)
      try {
        const roomAtStart = roomRef.current
        let ids: string[]
        if (roomAtStart === null) {
          // All media has no album cap: page through the day like Select day,
          // from the start — every selected id of the day is a match at
          // offset 0 — and keep paging past the per-read bound until the day
          // (or the route's offset maximum) ends the read, so no selected id
          // of the day survives the click.
          ids = []
          for (let readStart = 0; ;) {
            const read = await readWholeDayIds(
              key,
              generation,
              ownerGeneration,
              readStart
            )
            if (read === null) return
            ids = [...ids, ...read.ids]
            if (!read.hitPageBound || read.nextOffset > MAX_GALLERY_IDS_OFFSET)
              break
            readStart = read.nextOffset
          }
        } else {
          // The picker's day fits one request at the album cap.
          ids = await fetchIdsRef.current(key, MAX_GALLERY_ALBUM_ITEMS)
          if (
            generationRef.current !== generation ||
            disabledRef.current ||
            !mountedRef.current ||
            ownerGenerationRef.current !== ownerGeneration
          )
            return
          setBusyCount(ids.length)
        }
        for (const id of ids) {
          dayOf.current.set(id, key)
          sortOf.current.set(id, sortRef.current)
        }
        const idSet = new Set(ids)
        const removed = selectedRef.current.filter(
          (id) => idSet.has(id) || dayOf.current.get(id) === key
        )
        if (removed.length === 0) return
        const removedSet = new Set(removed)
        const id = toastId.current + 1
        toastId.current = id
        onChangeRef.current((current) =>
          current.filter((id) => !removedSet.has(id))
        )
        setToast({
          id,
          message: `Deselected ${pluralize(removed.length, 'photo')} ${formatDayToastPhrase(key)}`,
          undo: () => {
            const current = selectedRef.current
            const currentSet = new Set(current)
            const missing = removed.filter((itemId) => !currentSet.has(itemId))
            const roomNow = roomRef.current
            const allowed =
              roomNow === null
                ? missing.length
                : Math.min(missing.length, Math.max(roomNow, 0))
            const additions = missing.slice(0, allowed)
            const hitRoom = additions.length < missing.length
            onChangeRef.current((current) => {
              const currentSet = new Set(current)
              return [
                ...current,
                ...additions.filter((itemId) => !currentSet.has(itemId))
              ]
            })
            const message = `Restored ${pluralize(additions.length, 'photo')}${
              hitRoom ? ' · the album is full' : ''
            }`
            setToast((current) =>
              current?.id === id ? { ...current, message } : current
            )
            setAnnouncement(message)
          }
        })
        setAnnouncement(
          describeRangeResult({ added: [], removed, hitRoom: false })
        )
      } catch (cause) {
        if (generationRef.current !== generation || disabledRef.current) return
        lastFailedRef.current = { key, take: 0, kind: 'deselect' }
        setError(errorText(cause, 'Could not deselect the day'))
      } finally {
        if (
          generationRef.current === generation &&
          busyRequestRef.current === request
        ) {
          busyRequestRef.current = null
          setBusyKey(null)
          setBusyCount(0)
        }
      }
    },
    [readWholeDayIds]
  )

  // Re-runs the last failed selectDay or deselectDay (same key, same take);
  // a no-op when nothing has failed or a reset has cleared the failure.
  const retry = useCallback(() => {
    const failed = lastFailedRef.current
    if (!failed) return
    if (failed.kind === 'deselect') void deselectDay(failed.key)
    else void selectDay(failed.key, failed.take)
  }, [selectDay, deselectDay])

  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  return {
    noteItems,
    pickedInDay,
    selectDay,
    deselectDay,
    retryHydration,
    retry,
    busyKey,
    busyCount,
    toast,
    dismissToast,
    announcement,
    error
  }
}

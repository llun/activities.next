'use client'

import { Bookmark, Folder, FolderCog, FolderPlus, Inbox } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getBookmarks } from '@/lib/client'
import {
  setBookmarkFolders,
  useBookmarkFolders
} from '@/lib/components/bookmarks/bookmarkFolderStore'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { Posts } from '@/lib/components/posts/posts'
import {
  removeOriginalStatus,
  updateMatchingStatus,
  withBookmarkChange
} from '@/lib/components/posts/statusArray'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'
import {
  ALL_BOOKMARKS,
  UNFILED_BOOKMARK_FOLDER
} from '@/lib/services/bookmarks/constants'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

import { BookmarkFoldersDialog } from './BookmarkFoldersDialog'

const MAX_EMPTY_BOOKMARK_CONTINUATIONS = 5
// One instance, so the seeding effect below does not rerun on every render.
const NO_FOLDERS: BookmarkFolderEntity[] = []

// What the API's `folder_id` takes for a view; All bookmarks sends none.
const toFolderParam = (view: string) =>
  view === ALL_BOOKMARKS ? undefined : view

// Whether a bookmark filed in `folderId` (null: unfiled) belongs in `view`.
const isInView = (view: string, folderId: string | null) =>
  view === ALL_BOOKMARKS ||
  (view === UNFILED_BOOKMARK_FOLDER ? folderId === null : folderId === view)

// `status` with a deleted folder's id gone, the original of a boost included.
const clearBookmarkFolder = (status: Status, folderId: string): Status => {
  if (status.type === StatusType.enum.Announce) {
    const original = clearBookmarkFolder(status.originalStatus, folderId)
    return original === status.originalStatus
      ? status
      : ({ ...status, originalStatus: original } as Status)
  }
  return status.bookmarkFolderId === folderId
    ? { ...status, bookmarkFolderId: null }
    : status
}

// Keeps `?folder=` in step with the view without a navigation: the feed is
// filtered in place, and a reload or a shared link opens the same view.
const syncFolderQuery = (view: string) => {
  const url = new URL(window.location.href)
  if (view === ALL_BOOKMARKS) url.searchParams.delete('folder')
  else url.searchParams.set('folder', view)
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url)
  }
}

interface BookmarksTimelineProps {
  host: string
  statuses: Status[]
  initialNextMaxBookmarkId?: string | null
  currentTime: number
  currentActor: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
  /** The viewer's folders, by name. */
  folders?: BookmarkFolderEntity[]
  /** All bookmarks, `none` (unfiled) or a folder id. */
  initialFolder?: string
}

export const BookmarksTimeline: FC<BookmarksTimelineProps> = ({
  host,
  statuses,
  initialNextMaxBookmarkId = null,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit,
  folders: initialFolders = NO_FOLDERS,
  initialFolder = ALL_BOOKMARKS
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [view, setView] = useState(initialFolder)
  const viewRef = useRef(initialFolder)
  const [isSwitching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)
  const [isManaging, setManaging] = useState(false)

  // The page's own folder list seeds the store every ⋯ menu reads, and every
  // folder write goes back through the store.
  const folderStore = useBookmarkFolders()
  const folders =
    folderStore.status === 'loaded' ? folderStore.folders : initialFolders
  useEffect(() => {
    setBookmarkFolders(initialFolders)
  }, [initialFolders])
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    Boolean(initialNextMaxBookmarkId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const isLoadingRef = useRef<boolean>(false)
  const lastBookmarkIdRef = useRef<string | null>(initialNextMaxBookmarkId)

  const onPostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      removeOriginalStatus(previousStatuses, status.id)
    )
  }, [])

  const onPostUpdated = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      updateMatchingStatus(
        previousStatuses,
        status.id,
        () => status as StatusNote | StatusPoll
      )
    )
  }, [])

  const onBookmarkChanged = useCallback(
    (
      status: StatusNote | StatusPoll,
      isBookmarked: boolean,
      folderId?: string | null
    ) => {
      // Unbookmarked, or filed out of the folder on screen: it leaves the view.
      if (
        !isBookmarked ||
        (folderId !== undefined && !isInView(viewRef.current, folderId))
      ) {
        setCurrentStatuses((previousStatuses) =>
          removeOriginalStatus(previousStatuses, status.id)
        )
      } else {
        setCurrentStatuses((previousStatuses) =>
          updateMatchingStatus(previousStatuses, status.id, (target) =>
            withBookmarkChange(target, isBookmarked, folderId)
          )
        )
      }
    },
    []
  )

  const onLikeChanged = useCallback(
    (status: StatusNote | StatusPoll, isLiked: boolean) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          isActorLiked: isLiked,
          totalLikes: isLiked
            ? target.totalLikes + 1
            : Math.max(0, target.totalLikes - 1)
        }))
      )
    },
    []
  )

  const onReactionsChanged = useCallback(
    (status: StatusNote | StatusPoll, reactions: StatusReaction[]) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          reactions
        }))
      )
    },
    []
  )

  const loadMoreStatuses = useCallback(async () => {
    let nextBookmarkId = lastBookmarkIdRef.current
    if (isLoadingRef.current || !nextBookmarkId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      let emptyContinuations = 0

      const loadingView = viewRef.current
      while (nextBookmarkId) {
        const result = await getBookmarks({
          maxBookmarkId: nextBookmarkId,
          folderId: toFolderParam(loadingView)
        })
        // The reader switched folders meanwhile; this page is not theirs.
        if (viewRef.current !== loadingView) return

        lastBookmarkIdRef.current = result.nextMaxBookmarkId

        if (result.statuses.length > 0) {
          setHasMoreStatuses(Boolean(result.nextMaxBookmarkId))
          setCurrentStatuses((previousStatuses) => [
            ...previousStatuses,
            ...result.statuses
          ])
          return
        }

        if (!result.nextMaxBookmarkId) {
          setHasMoreStatuses(false)
          return
        }

        emptyContinuations++
        if (emptyContinuations >= MAX_EMPTY_BOOKMARK_CONTINUATIONS) {
          setHasMoreStatuses(true)
          return
        }

        nextBookmarkId = result.nextMaxBookmarkId
      }
    } catch (_error) {
      // Error loading more - user can retry by clicking the button
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [])

  // Every switch (and a reload of the view on screen) fetches its first page
  // afresh; only the latest request may fill the feed.
  const requestRef = useRef(0)
  const loadView = useCallback(async (next: string) => {
    const request = ++requestRef.current
    viewRef.current = next
    setView(next)
    syncFolderQuery(next)
    setSwitching(true)
    setSwitchError(false)
    setCurrentStatuses([])
    setHasMoreStatuses(false)
    lastBookmarkIdRef.current = null
    try {
      const result = await getBookmarks({ folderId: toFolderParam(next) })
      if (requestRef.current !== request) return
      setCurrentStatuses(result.statuses)
      lastBookmarkIdRef.current = result.nextMaxBookmarkId
      setHasMoreStatuses(Boolean(result.nextMaxBookmarkId))
    } catch {
      if (requestRef.current === request) setSwitchError(true)
    } finally {
      if (requestRef.current === request) setSwitching(false)
    }
  }, [])

  const selectView = useCallback(
    async (next: string) => {
      if (next !== viewRef.current) await loadView(next)
    },
    [loadView]
  )

  // `?folder=` named a folder the server did not find (deleted, or not the
  // viewer's), so the page opened All bookmarks: drop the dead parameter.
  useEffect(() => {
    if (initialFolder === ALL_BOOKMARKS) syncFolderQuery(ALL_BOOKMARKS)
  }, [initialFolder])

  const onFolderDeleted = useCallback(
    (id: string) => {
      // Its bookmarks are unfiled now.
      setCurrentStatuses((previousStatuses) =>
        previousStatuses.map((item) => clearBookmarkFolder(item, id))
      )
      if (viewRef.current === id) void loadView(ALL_BOOKMARKS)
      // Unfiled gains the folder's bookmarks, so it is read again.
      else if (viewRef.current === UNFILED_BOOKMARK_FOLDER) {
        void loadView(UNFILED_BOOKMARK_FOLDER)
      }
    },
    [loadView]
  )

  const tabs: SectionNavSelectTab<string>[] = [
    { id: ALL_BOOKMARKS, label: 'All bookmarks', icon: Bookmark },
    { id: UNFILED_BOOKMARK_FOLDER, label: 'Unfiled', icon: Inbox },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      icon: Folder
    }))
  ]
  const hasFolders = folders.length > 0
  const empty =
    view === ALL_BOOKMARKS
      ? {
          title: 'No bookmarks yet',
          body: 'Bookmark posts to find them here later.'
        }
      : view === UNFILED_BOOKMARK_FOLDER
        ? {
            title: 'No unfiled bookmarks',
            body: 'Every bookmark here is in a folder.'
          }
        : {
            title: 'This folder is empty',
            body: 'File a post here from its ⋯ menu.'
          }

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    enabled: hasMoreStatuses,
    onLoadMore: loadMoreStatuses
  })

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        title="Bookmarks"
        description="Saved posts from your timelines."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            onClick={() => setManaging(true)}
          >
            {hasFolders ? <FolderCog /> : <FolderPlus />}
            {hasFolders ? 'Manage folders' : 'New folder'}
          </Button>
        }
      />

      {hasFolders ? (
        <SectionNavSelect
          label="Bookmark folders"
          tabs={tabs}
          active={tabs.some((tab) => tab.id === view) ? view : ALL_BOOKMARKS}
          onChange={(next) => void selectView(next)}
        />
      ) : null}

      <BookmarkFoldersDialog
        open={isManaging}
        onOpenChange={setManaging}
        folders={folders}
        onDeleted={onFolderDeleted}
      />

      {switchError ? (
        <Alert title="Couldn't load these bookmarks. Please try again." />
      ) : isSwitching ? (
        <div aria-busy="true">
          <span role="status" className="sr-only">
            Loading bookmarks
          </span>
          <PostListSkeleton />
        </div>
      ) : currentStatuses.length > 0 ? (
        <Posts
          host={host}
          currentTime={currentTime}
          statuses={currentStatuses}
          currentActor={currentActor}
          showActions
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={onPostDeleted}
          onPostUpdated={onPostUpdated}
          onBookmarkChanged={onBookmarkChanged}
          onLikeChanged={onLikeChanged}
          onReactionsChanged={onReactionsChanged}
        />
      ) : (
        <EmptyState
          icon={view === ALL_BOOKMARKS ? Bookmark : Folder}
          titleAs="h2"
          title={empty.title}
        >
          {empty.body}
        </EmptyState>
      )}

      {hasMoreStatuses && lastBookmarkIdRef.current && (
        <LoadMoreButton
          containerRef={loadMoreRef}
          isLoading={isLoadingMoreStatuses}
          onClick={loadMoreStatuses}
        />
      )}
    </div>
  )
}

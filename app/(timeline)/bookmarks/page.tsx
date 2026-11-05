import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { toBookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'
import {
  ALL_BOOKMARKS,
  UNFILED_BOOKMARK_FOLDER
} from '@/lib/services/bookmarks/constants'
import { getBookmarkedStatusesPage } from '@/lib/services/bookmarks/getBookmarkedStatusesPage'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { BookmarksTimeline } from './BookmarksTimeline'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Bookmarks'
}

interface Props {
  // `?folder=<id|none>`: the folder the page opens on.
  searchParams: Promise<{ folder?: string | string[] }>
}

const Page = async ({ searchParams }: Props) => {
  const { host, mediaStorage } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const [settings, folders, { folder: folderParam }] = await Promise.all([
    database.getActorSettings({ actorId: actor.id }),
    database.getBookmarkFolders({ actorId: actor.id }),
    searchParams
  ])
  const requested = typeof folderParam === 'string' ? folderParam : undefined
  // An unknown folder (deleted, or someone else's) opens All bookmarks.
  const activeFolder =
    requested === UNFILED_BOOKMARK_FOLDER ||
    folders.some((folder) => folder.id === requested)
      ? (requested as string)
      : ALL_BOOKMARKS
  const { statuses, nextMaxBookmarkId } = await getBookmarkedStatusesPage({
    database,
    actorId: actor.id,
    currentActor: actor,
    limit: 20,
    folderId:
      activeFolder === ALL_BOOKMARKS
        ? undefined
        : activeFolder === UNFILED_BOOKMARK_FOLDER
          ? null
          : activeFolder
  })

  return (
    <BookmarksTimeline
      host={host}
      statuses={statuses.map((item) => cleanJson(item))}
      initialNextMaxBookmarkId={nextMaxBookmarkId}
      folders={folders.map(toBookmarkFolderEntity)}
      initialFolder={activeFolder}
      currentTime={Date.now()}
      currentActor={getActorProfile(actor)}
      isMediaUploadEnabled={Boolean(mediaStorage)}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page

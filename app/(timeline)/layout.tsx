import { FC, ReactNode } from 'react'

import {
  PendingProfileNavigationProvider,
  PendingProfileOverlay
} from '@/app/(timeline)/PendingProfileNavigation'
import { Modal } from '@/app/Modal'
import {
  ConnectionAnnouncer,
  ConnectionStatusBar
} from '@/lib/components/connection/ConnectionStatus'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'
import { Sidebar } from '@/lib/components/layout/sidebar'
import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { SessionKeepAlive } from '@/lib/components/session-keep-alive'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getVisitedFeatures } from '@/lib/services/domains/visitedFeatures'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { cn } from '@/lib/utils'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = async ({ children }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)

  // The admin-configurable limits the browser needs, so the composer's
  // character counter, the poll editor, and the image pickers size themselves
  // to the same values the create/upload endpoints enforce — without threading
  // a prop through each page (the composer renders inline under posts across
  // the whole group). Both branches provide it so no descendant can end up
  // outside the provider.
  const {
    posts,
    media,
    polls,
    features: serverFeatures
  } = await getResolvedServerSettings(database)
  // The server's switches, minus what the visited domain turned off.
  const features = await getVisitedFeatures(serverFeatures)
  const instanceLimits = {
    maxStatusCharacters: posts.maxCharacters,
    maxMediaFileSize: media.maxFileSize,
    maxMediaAttachments: posts.maxMediaAttachments,
    maxPollOptions: polls.maxOptions,
    maxPollOptionCharacters: polls.maxCharactersPerOption,
    minPollExpirationSeconds: polls.minExpirationSeconds,
    maxPollExpirationSeconds: polls.maxExpirationSeconds
  }

  // Logged-out visitors render without the nav sidebar. The home route renders
  // a full-bleed landing (see app/(timeline)/(home)/page.tsx), so this branch stays
  // chrome-less; the federated reading surfaces that still need the public top
  // bar + footer (single status, profiles, hashtags, terms of service and privacy policy)
  // wrap themselves in `PublicShell` via their own sub-layouts
  // (`[actor]/layout.tsx`, `tags/layout.tsx`, `(policies)/layout.tsx`).
  if (!actor) {
    return (
      <InstanceLimitsProvider {...instanceLimits}>
        <PlaybackPreferencesProvider actorId={null} initialAutoplayGifs={false}>
          <PendingProfileNavigationProvider>
            {children}
          </PendingProfileNavigationProvider>
        </PlaybackPreferencesProvider>
      </InstanceLimitsProvider>
    )
  }

  // From here on the visitor is signed in (the logged-out branch returned
  // above), so the nav chrome always renders.
  const user = {
    name: actor.name || actor.username,
    username: actor.username,
    handle: getMention(getActorProfile(actor), true),
    avatarUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : undefined
  }

  // Get all actors for the account
  const actors = actor.account?.id
    ? await database.getActorsForAccount({ accountId: actor.account.id })
    : []

  const currentActor = {
    id: actor.id,
    username: actor.username,
    domain: actor.domain,
    name: actor.name,
    iconUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : null
  }

  // Fitness is a first-class section for every signed-in local account (like
  // Bookmarks/Messages), so new users can discover the import/Strava setup even
  // before they have any activity. The Overview itself handles the empty state.
  // An admin can drop it from navigation instance-wide; the section keeps
  // working for anyone who follows a link straight to it.
  const fitnessUrl = actor.account && features.fitness ? '/fitness' : undefined
  // Gallery needs a local account too, but is not an admin-switchable feature.
  const galleryUrl = actor.account ? '/gallery' : undefined
  const isAdmin = actor.account?.role === 'admin'
  // Admins see the unresolved report count on the sidebar's Admin item, as the
  // Notifications item carries the unread count. Capped at 100 (the badge shows
  // 99+); the Admin section's own menu row counts the same way
  // (app/(timeline)/admin/layout.tsx). Only admins are queried.
  //
  // The reads are independent, so they run together: the unread count, the
  // report count, the lists that drive the expandable Lists group in the
  // sidebar, and the navigation the user customized (their order, and the items
  // they tucked under "More"), which every nav surface — and the settings
  // manager that edits them — starts from.
  const [unreadCount, openReportCount, lists, actorSettings] =
    await Promise.all([
      database.getNotificationsCount({ actorId: actor.id, onlyUnread: true }),
      isAdmin ? database.countOpenReports({ limit: 100 }) : 0,
      database.getLists({ actorId: actor.id }),
      database.getActorSettings({ actorId: actor.id })
    ])

  const formattedActors = actors.map((a) => ({
    id: a.id,
    username: a.username,
    domain: a.domain,
    name: a.name,
    iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null,
    deletionStatus: a.deletionStatus ?? null,
    deletionScheduledAt: a.deletionScheduledAt ?? null
  }))

  const formattedLists = lists.map((list) => ({
    id: list.id,
    title: list.title
  }))

  return (
    <InstanceLimitsProvider {...instanceLimits}>
      {/* Wraps the children too: on wide screens the Settings → Sidebar
          manager edits the very sidebar rendered beside it, and a soft
          navigation never re-runs this layout to re-seed them separately. */}
      <PlaybackPreferencesProvider
        actorId={actor.id}
        initialAutoplayGifs={actorSettings?.readingAutoplayGifs ?? false}
      >
        <NavPreferencesProvider
          initialOrder={actorSettings?.navOrder}
          initialHidden={actorSettings?.navHidden}
        >
          <MobileNavigationProvider>
            <PendingProfileNavigationProvider>
              <DraftsProvider
                accountId={actor.account?.id ?? ''}
                actorId={actor.id}
              >
                <div className="min-h-dvh">
                  <Sidebar
                    user={user}
                    currentActor={currentActor}
                    actors={formattedActors}
                    unreadCount={unreadCount}
                    openReportCount={openReportCount}
                    fitnessUrl={fitnessUrl}
                    galleryUrl={galleryUrl}
                    isAdmin={isAdmin}
                    lists={formattedLists}
                    features={features}
                  />
                  <MobileNav
                    user={user}
                    currentActor={currentActor}
                    actors={formattedActors}
                    unreadCount={unreadCount}
                    openReportCount={openReportCount}
                    fitnessUrl={fitnessUrl}
                    galleryUrl={galleryUrl}
                    isAdmin={isAdmin}
                    lists={formattedLists}
                    features={features}
                  />
                  <main
                    data-app-shell=""
                    className={cn(
                      'flex min-h-dvh flex-col overflow-x-clip pb-6',
                      'md:pl-[72px] md:[--sidebar-w:72px] xl:pl-[280px] xl:[--sidebar-w:280px]'
                    )}
                  >
                    <div className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 pb-6">
                      <ConnectionStatusBar />
                      {children}
                    </div>
                    <PendingProfileOverlay variant="signed-in" />
                  </main>
                  <Modal />
                  <SessionKeepAlive />
                  <ConnectionAnnouncer />
                </div>
              </DraftsProvider>
            </PendingProfileNavigationProvider>
          </MobileNavigationProvider>
        </NavPreferencesProvider>
      </PlaybackPreferencesProvider>
    </InstanceLimitsProvider>
  )
}

export default Layout

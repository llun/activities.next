import { ChevronRight, Pencil } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ProfileAvatar } from '@/lib/components/settings/ProfileAvatar'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings'
}

// The Settings index at every width. This page is only the profile card; the
// section layout lists the groups under it (`SectionIndex`).
const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const handle = `@${actor.username}@${actor.domain}`
  const iconUrl = isRealAvatar(actor.iconUrl) ? (actor.iconUrl ?? null) : null

  return (
    <>
      {/* Desktop: who these settings are for, with both ways into the
          profile. */}
      <Frame className="flex items-center gap-4 p-4 max-lg:hidden">
        <ProfileAvatar
          username={actor.username}
          iconUrl={iconUrl}
          className="size-14 text-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">
            {actor.name || actor.username}
          </p>
          <p className="truncate text-sm text-muted-foreground">{handle}</p>
          <p className="text-xs text-muted-foreground">
            These settings are for this profile only.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline">
            <Link href={`/${handle}`} prefetch={false}>
              View profile
            </Link>
          </Button>
          <Button asChild>
            <Link href="/settings/profile">
              <Pencil />
              Edit profile
            </Link>
          </Button>
        </div>
      </Frame>

      {/* Phones and tablets: the list page opens on Edit profile. */}
      <FramedList className="lg:hidden">
        <FramedListItem
          href="/settings/profile"
          className="flex items-center gap-3"
        >
          <ProfileAvatar
            username={actor.username}
            iconUrl={iconUrl}
            className="size-10"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Edit profile</span>
            <span className="block text-sm text-muted-foreground">
              Name, bio, photos, fields and tabs
            </span>
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </FramedListItem>
      </FramedList>
    </>
  )
}

export default Page

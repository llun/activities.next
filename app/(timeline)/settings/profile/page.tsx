import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getActorEmojiTags } from '@/lib/actions/utils'
import { ProfileEditor } from '@/lib/components/settings/profile/ProfileEditor'
import { SwitchedNotice } from '@/lib/components/settings/profile/SwitchedNotice'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import type { SavedProfile } from '@/lib/types/domain/savedProfile'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import {
  getActorProfileUrl,
  getPersonFromActor
} from '@/lib/utils/getPersonFromActor'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Edit profile'
}

interface Props {
  searchParams?: Promise<{ switched?: string | string[] }>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const sessionActor = await getActorFromSession(database, session)
  if (!sessionActor || !sessionActor.account) {
    return redirect('/auth/signin')
  }
  // The session's actor is a partial one (no tab flags, links or tags), so
  // every value the editor starts from comes from the stored actor.
  const actor = await database.getActorFromId({ id: sessionActor.id })
  if (!actor) {
    return redirect('/auth/signin')
  }

  const profile = getActorProfile(actor)
  const settings = await database.getActorSettings({ actorId: actor.id })
  const handle = `@${actor.username}@${actor.domain}`
  const switched = (await searchParams)?.switched === '1'

  // The same shape the save answers with, so the editor starts from what a
  // save would have returned.
  const saved: SavedProfile = {
    name: profile.name ?? '',
    summary: profile.summary ?? '',
    fields: (settings?.fields ?? []).map((field) => ({
      name: field.name,
      value: field.value,
      verifiedAt: field.verifiedAt ? getISOTimeUTC(field.verifiedAt) : null
    })),
    iconUrl: profile.iconUrl || null,
    headerImageUrl: profile.headerImageUrl || null,
    avatarDescription: settings?.avatarDescription ?? '',
    headerDescription: settings?.headerDescription ?? '',
    showReplies: actor.showReplies ?? true,
    showMedia: actor.showMedia ?? true,
    showGallery: actor.showGallery ?? true,
    showFitness: actor.showFitness ?? true
  }

  return (
    <div className="space-y-6">
      {/* Part of the page's stack, not the editor's: "Edit profile" on another
          profile you own switches to it first and lands here with ?switched=1. */}
      {switched ? <SwitchedNotice handle={handle} /> : null}
      <ProfileEditor
        key={actor.id}
        actorId={actor.id}
        profile={saved}
        switched={switched}
        username={actor.username}
        handle={handle}
        profileUrl={getActorProfileUrl(actor)}
        profilePath={`/@${actor.username}@${actor.domain}`}
        tags={getActorEmojiTags(getPersonFromActor(actor))}
      />
    </div>
  )
}

export default Page

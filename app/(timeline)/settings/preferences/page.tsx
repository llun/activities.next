import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PreferencesSettings } from '@/lib/components/settings/PreferencesSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Preferences'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const settings = await database.getActorSettings({ actorId: actor.id })

  return (
    <PreferencesSettings
      initialPreferences={{
        visibility: settings?.defaultPrivacy ?? 'public',
        sensitive: settings?.defaultSensitive ?? false,
        language: settings?.defaultLanguage ?? 'en',
        expandMedia: settings?.readingExpandMedia ?? 'default',
        expandSpoilers: settings?.readingExpandSpoilers ?? false,
        autoplayGifs: settings?.readingAutoplayGifs ?? false
      }}
    />
  )
}

export default Page

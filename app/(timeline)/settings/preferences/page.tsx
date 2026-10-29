import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PreferencesSettings } from '@/lib/components/settings/PreferencesSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getPostingLanguage } from '@/lib/utils/postingLanguage'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Preferences'
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
        quotePolicy: settings?.defaultQuotePolicy ?? 'public',
        sensitive: settings?.defaultSensitive ?? false,
        language: getPostingLanguage(settings?.defaultLanguage),
        expandMedia: settings?.readingExpandMedia ?? 'default',
        expandSpoilers: settings?.readingExpandSpoilers ?? false,
        autoplayGifs: settings?.readingAutoplayGifs ?? false
      }}
    />
  )
}

export default Page

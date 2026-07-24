import { redirect } from 'next/navigation'

import { PostsMediaSettingsForm } from '@/lib/components/admin/settings/PostsMediaSettingsForm'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { describeMediaStorageBackend } from '@/lib/services/medias/storageBackendSummary'
import { getServerSettingsView } from '@/lib/services/serverSettings'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const { settings, locks } = await getServerSettingsView(database)
  // The storage backend stays environment-only (it is infrastructure read at
  // boot), so it is summarised here and shown read-only.
  const storageBackend = describeMediaStorageBackend(getConfig().mediaStorage)
  return (
    <PostsMediaSettingsForm
      settings={settings}
      locks={locks}
      storageBackend={storageBackend}
    />
  )
}

export default Page

import { redirect } from 'next/navigation'

import { PostsMediaSettingsForm } from '@/lib/components/admin/settings/PostsMediaSettingsForm'
import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getServerSettingsView } from '@/lib/services/serverSettings'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const STORAGE_LABELS: Record<MediaStorageType, string> = {
  [MediaStorageType.LocalFile]: 'Local filesystem',
  [MediaStorageType.ObjectStorage]: 'Object storage',
  [MediaStorageType.S3Storage]: 'S3-compatible storage'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const config = getConfig()
  const storageBackend = config.mediaStorage
    ? STORAGE_LABELS[config.mediaStorage.type]
    : 'Local filesystem (default)'

  const { settings, locks } = await getServerSettingsView(database)
  return (
    <PostsMediaSettingsForm
      settings={settings}
      locks={locks}
      storageBackend={storageBackend}
    />
  )
}

export default Page

import { redirect } from 'next/navigation'

import { PostsMediaSettingsForm } from '@/lib/components/admin/settings/PostsMediaSettingsForm'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
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
  return <PostsMediaSettingsForm settings={settings} locks={locks} />
}

export default Page

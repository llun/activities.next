import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const version = (require('@/package.json') as { version: string }).version
  const pushEnabled = Boolean(getConfig().push)

  return (
    <div className="space-y-6">
      <PageHeader title="System" description="Version and configuration." />

      <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Version</h2>
        <p className="text-2xl font-bold font-mono">{version}</p>
      </div>

      <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Push Notifications</h2>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              pushEnabled
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {pushEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {!pushEnabled && (
          <p className="mt-3 text-sm text-muted-foreground">
            Browser push notifications are not configured.
          </p>
        )}
      </div>
    </div>
  )
}

export default Page

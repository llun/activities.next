import { redirect } from 'next/navigation'

import { revealEnvVar } from '@/app/(timeline)/admin/system/actions'
import { EnvironmentVariables } from '@/lib/components/admin/EnvironmentVariables'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { ENV_VAR_PREFIX } from '@/lib/utils/adminConstants'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const SENSITIVE_PATTERNS = [
  'secret',
  'password',
  'key',
  'token',
  'credential',
  'private',
  'database',
  'auth'
]

const isSensitiveKey = (key: string): boolean => {
  const lower = key.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
}

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const version = (require('@/package.json') as { version: string }).version

  const pushEnabled = !!(
    process.env.ACTIVITIES_PUSH_VAPID_PUBLIC_KEY &&
    process.env.ACTIVITIES_PUSH_VAPID_PRIVATE_KEY &&
    process.env.ACTIVITIES_PUSH_VAPID_EMAIL
  )

  // Collect ACTIVITIES_* environment variables; mask sensitive values server-side
  const envVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith(ENV_VAR_PREFIX))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const isSensitive = isSensitiveKey(key)
      return {
        key,
        value: isSensitive ? null : (value ?? ''),
        isSensitive
      }
    })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">System</h1>
        <p className="text-sm text-muted-foreground">
          Version and configuration
        </p>
      </div>

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
            Set{' '}
            <code className="font-mono text-xs">
              ACTIVITIES_PUSH_VAPID_PUBLIC_KEY
            </code>
            ,{' '}
            <code className="font-mono text-xs">
              ACTIVITIES_PUSH_VAPID_PRIVATE_KEY
            </code>
            , and{' '}
            <code className="font-mono text-xs">
              ACTIVITIES_PUSH_VAPID_EMAIL
            </code>{' '}
            to enable browser push notifications. Generate VAPID keys with:{' '}
            <code className="font-mono text-xs">
              npx web-push generate-vapid-keys
            </code>
          </p>
        )}
      </div>

      <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Environment Variables</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Showing {envVars.length} configuration variable
          {envVars.length !== 1 ? 's' : ''}. Sensitive values are hidden by
          default.
        </p>
        <EnvironmentVariables variables={envVars} revealEnvVar={revealEnvVar} />
      </div>
    </div>
  )
}

export default Page

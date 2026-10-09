import { Bell, Tag } from 'lucide-react'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import packageJson from '@/package.json'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const version = packageJson.version
  const pushEnabled = Boolean(getConfig().push)

  return (
    <div className="space-y-6">
      <PageHeader title="System" description="Version and configuration." />

      <Section title="Server">
        <StatStrip columns={2}>
          <StatCell
            label="Version"
            icon={Tag}
            value={<span className="font-mono">{version}</span>}
          />
          <StatCell
            label="Push notifications"
            icon={Bell}
            value={pushEnabled ? 'Enabled' : 'Disabled'}
          />
        </StatStrip>
      </Section>

      {!pushEnabled && (
        <Alert tone="info" live={false} title="Push notifications are off">
          Browser push notifications are not configured.
        </Alert>
      )}
    </div>
  )
}

export default Page

import { notFound, redirect } from 'next/navigation'

import { DomainSettings } from '@/lib/components/admin/domains/DomainSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { readDomainRouteParam } from '@/lib/services/domains/adminDomainTypes'
import {
  getAdminDomain,
  getEnvDomains
} from '@/lib/services/domains/adminDomains'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ domain: string }>
}

const Page = async ({ params }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const domain = await getAdminDomain(
    database,
    readDomainRouteParam((await params).domain)
  )
  if (!domain) return notFound()

  return (
    <DomainSettings
      key={domain.domain}
      domain={domain}
      primaryDomain={getEnvDomains().primary}
    />
  )
}

export default Page

import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { MediaManagement } from '@/lib/components/settings/MediaManagement'
import { getDatabase } from '@/lib/database'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Media Storage'
}

const Page = async ({
  searchParams
}: {
  searchParams: Promise<{ page?: string; limit?: string }>
}) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const params = await searchParams

  // Parse pagination parameters with defaults and validation
  const page = Math.max(1, Math.min(10000, parseInt(params.page || '1', 10)))
  const itemsPerPage = [25, 50, 100].includes(
    parseInt(params.limit || '25', 10)
  )
    ? parseInt(params.limit || '25', 10)
    : 25

  // Get storage usage and quota limit
  const used = await database.getStorageUsageForAccount({
    accountId: actor.account.id
  })
  const limit = getQuotaLimit()

  // Get medias for account with their associated statusId
  const result = await database.getMediasWithStatusForAccount({
    accountId: actor.account.id,
    limit: itemsPerPage,
    page
  })

  return (
    <MediaManagement
      used={used}
      limit={limit}
      medias={result.items.map((media) => {
        // Use full path for the URL to support Object Storage keys
        const url = `/api/v1/files/${media.original.path}`
        return {
          id: media.id,
          actorId: media.actorId,
          bytes: media.original.bytes + (media.thumbnail?.bytes ?? 0),
          mimeType: media.original.mimeType,
          width: media.original.metaData.width,
          height: media.original.metaData.height,
          description: media.description,
          url,
          statusId: media.statusId
        }
      })}
      currentPage={page}
      itemsPerPage={itemsPerPage}
      totalItems={result.total}
    />
  )
}

export default Page

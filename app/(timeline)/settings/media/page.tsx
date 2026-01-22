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
  searchParams: { page?: string; limit?: string }
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

  // Parse pagination parameters with defaults and validation
  const page = Math.max(1, Math.min(10000, parseInt(searchParams.page || '1', 10)))
  const itemsPerPage = [25, 50, 100].includes(parseInt(searchParams.limit || '25', 10))
    ? parseInt(searchParams.limit || '25', 10)
    : 25

  // Get storage usage and quota limit
  const used = await database.getStorageUsageForAccount({
    accountId: actor.account.id
  })
  const limit = getQuotaLimit()

  // Get medias for account with their associated statusId
  const medias = await database.getMediasWithStatusForAccount({
    accountId: actor.account.id,
    limit: itemsPerPage
  })

  return (
    <MediaManagement
      used={used}
      limit={limit}
      medias={medias.map((media) => {
        // Extract just the filename from the full path
        const filename = media.original.path.split('/').pop()
        const url = `/api/v1/files/${filename}`
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
    />
  )
}

export default Page

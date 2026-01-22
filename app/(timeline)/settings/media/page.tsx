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

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  // Get storage usage and quota limit
  const used = await database.getStorageUsageForAccount({
    accountId: actor.account.id
  })
  const limit = getQuotaLimit()

  // Get medias for account with their associated statusId
  const medias = await database.getMediasWithStatusForAccount({
    accountId: actor.account.id,
    limit: 100
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
    />
  )
}

export default Page

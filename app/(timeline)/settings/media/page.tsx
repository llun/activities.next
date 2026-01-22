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

  // Get medias for account
  const medias = await database.getMediasForAccount({
    accountId: actor.account.id,
    limit: 100
  })

  // Get all attachments for the account to find which posts use which media
  const attachments = await database.getAttachmentsForActor({
    actorId: actor.id,
    limit: 1000
  })

  // Create a map of media URL to statusId
  const mediaUrlToStatusId = new Map<string, string>()
  attachments.forEach((attachment) => {
    mediaUrlToStatusId.set(attachment.url, attachment.statusId)
  })

  return (
    <MediaManagement
      used={used}
      limit={limit}
      medias={medias.map((media) => {
        // Extract just the filename from the full path
        const filename = media.original.path.split('/').pop()
        const url = `/api/v1/files/${filename}`
        // Attachment URLs are stored as full URLs, so we need to match against the full URL pattern
        const statusId = [...mediaUrlToStatusId.entries()].find(([attachmentUrl]) =>
          attachmentUrl.endsWith(`/api/v1/files/${filename}`)
        )?.[1]
        return {
          id: media.id,
          actorId: media.actorId,
          bytes: media.original.bytes + (media.thumbnail?.bytes ?? 0),
          mimeType: media.original.mimeType,
          width: media.original.metaData.width,
          height: media.original.metaData.height,
          description: media.description,
          url,
          statusId
        }
      })}
    />
  )
}

export default Page

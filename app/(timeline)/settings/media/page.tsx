import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { MediaManagement } from '@/lib/components/settings/MediaManagement'
import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
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
  const page = Math.max(
    1,
    Math.min(10000, parseInt(searchParams.page || '1', 10))
  )
  const itemsPerPage = [25, 50, 100].includes(
    parseInt(searchParams.limit || '25', 10)
  )
    ? parseInt(searchParams.limit || '25', 10)
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

  // Get config to determine media storage type and construct proper URLs
  const config = getConfig()
  const { mediaStorage, host } = config

  return (
    <MediaManagement
      used={used}
      limit={limit}
      medias={result.items.map((media) => {
        // For Object Storage with hostname configured, use direct URL
        // Otherwise use the API endpoint with full path
        let url: string
        if (
          mediaStorage?.type === MediaStorageType.ObjectStorage ||
          mediaStorage?.type === MediaStorageType.S3Storage
        ) {
          if (mediaStorage.hostname) {
            // Direct access via configured hostname
            url = `https://${mediaStorage.hostname}/${media.original.path}`
          } else {
            // Proxy through API with full path
            // Determine protocol based on host (http for localhost, https otherwise)
            const protocol =
              host.startsWith('localhost') ||
              host.startsWith('127.0.0.1') ||
              host.startsWith('::1') ||
              host.startsWith('[::1]')
                ? 'http'
                : 'https'
            url = `${protocol}://${host}/api/v1/files/${media.original.path}`
          }
        } else {
          // Local file storage - extract just the filename
          const filename = media.original.path.split('/').pop()
          url = `/api/v1/files/${filename}`
        }
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

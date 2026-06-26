import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { FitnessFileManagement } from '@/lib/components/settings/FitnessFileManagement'
import { FitnessImport } from '@/lib/components/settings/FitnessImport'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { STUCK_PROCESSING_THRESHOLD_MS } from '@/lib/services/fitness-files/processingState'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Files'
}

type PageSearchParams = {
  page?: string
  limit?: string
}

const Page = async ({
  searchParams
}: {
  searchParams: PageSearchParams | Promise<PageSearchParams>
}) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const actorHandle = actor
    ? getMention(getActorProfile(actor), true)
    : undefined

  const params = await Promise.resolve(searchParams)
  const rawPage = Number.parseInt(params.page || '1', 10)
  const page = Number.isNaN(rawPage) ? 1 : Math.max(1, Math.min(10000, rawPage))
  const parsedLimit = parseInt(params.limit || '25', 10)
  const itemsPerPage = [25, 50, 100].includes(parsedLimit) ? parsedLimit : 25

  const [mediaUsed, fitnessUsed, result, retriableBatchIds] = await Promise.all(
    [
      database.getStorageUsageForAccount({
        accountId: actor.account.id
      }),
      database.getFitnessStorageUsageForAccount({
        accountId: actor.account.id
      }),
      database.getFitnessFilesWithStatusForAccount({
        accountId: actor.account.id,
        limit: itemsPerPage,
        page
      }),
      // Computed across ALL the actor's files (not just the current page) so the
      // "Retry all failed" button is visible whenever a retry would do work.
      database.getRetriableFitnessImportBatchIds({
        actorId: actor.id,
        stuckBefore: new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS)
      })
    ]
  )

  const limit = getQuotaLimit()
  const used = mediaUsed + fitnessUsed

  return (
    <div className="space-y-6">
      <PageHeader
        title="Files"
        description="Import activities and manage your fitness file storage."
      />
      <FitnessImport actorHandle={actorHandle} />
      <FitnessFileManagement
        used={used}
        limit={limit}
        fitnessFiles={result.items.map((fitnessFile) => ({
          id: fitnessFile.id,
          actorId: fitnessFile.actorId,
          fileName: fitnessFile.fileName,
          fileType: fitnessFile.fileType,
          mimeType: fitnessFile.mimeType,
          bytes: fitnessFile.bytes,
          description: fitnessFile.description,
          createdAt: fitnessFile.createdAt,
          url: `/api/v1/fitness-files/${fitnessFile.id}`,
          statusId: fitnessFile.statusId ?? undefined,
          importStatus: fitnessFile.importStatus ?? undefined,
          importError: fitnessFile.importError ?? null,
          importBatchId: fitnessFile.importBatchId ?? undefined
        }))}
        hasRetriableImport={retriableBatchIds.length > 0}
        currentPage={page}
        itemsPerPage={itemsPerPage}
        totalItems={result.total}
      />
    </div>
  )
}

export default Page

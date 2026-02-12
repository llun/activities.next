import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { FitnessFileManagement } from '@/lib/components/settings/FitnessFileManagement'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getFitnessQuotaLimit } from '@/lib/services/fitness-files/quota'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Files'
}

interface PaginatedFitnessFiles {
  items: {
    id: string
    actorId: string
    fileName: string
    fileType: 'fit' | 'gpx' | 'tcx'
    mimeType: string
    bytes: number
    description?: string
    createdAt: number
    statusId?: string | null
  }[]
  total: number
}

const getFitnessFilesForAccount = async (
  database: Database,
  accountId: string,
  itemsPerPage: number,
  page: number
): Promise<PaginatedFitnessFiles> => {
  const accountQuery = (
    database as {
      getFitnessFilesWithStatusForAccount?: (params: {
        accountId: string
        limit?: number
        page?: number
      }) => Promise<PaginatedFitnessFiles>
    }
  ).getFitnessFilesWithStatusForAccount

  if (accountQuery) {
    return accountQuery({
      accountId,
      limit: itemsPerPage,
      page
    })
  }

  // Fallback for stale memoized DB instances that don't expose the new method yet.
  const actors = await database.getActorsForAccount({ accountId })
  const fileLists = await Promise.all(
    actors.map((accountActor) =>
      database.getFitnessFilesByActor({
        actorId: accountActor.id,
        limit: 10000
      })
    )
  )

  const allFiles = fileLists.flat().sort((a, b) => b.createdAt - a.createdAt)
  const offset = (page - 1) * itemsPerPage

  return {
    items: allFiles.slice(offset, offset + itemsPerPage),
    total: allFiles.length
  }
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
  const page = Math.max(1, Math.min(10000, parseInt(params.page || '1', 10)))
  const itemsPerPage = [25, 50, 100].includes(
    parseInt(params.limit || '25', 10)
  )
    ? parseInt(params.limit || '25', 10)
    : 25

  const [used, result] = await Promise.all([
    database.getFitnessStorageUsageForAccount({
      accountId: actor.account.id
    }),
    getFitnessFilesForAccount(database, actor.account.id, itemsPerPage, page)
  ])

  const limit = getFitnessQuotaLimit()

  return (
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
        statusId: fitnessFile.statusId ?? undefined
      }))}
      currentPage={page}
      itemsPerPage={itemsPerPage}
      totalItems={result.total}
    />
  )
}

export default Page

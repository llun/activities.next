import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { FitnessFileManagement } from '@/lib/components/settings/FitnessFileManagement'
import { getDatabase } from '@/lib/database'
import { getFitnessQuotaLimit } from '@/lib/services/fitness-files/quota'
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

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const params = await Promise.resolve(searchParams)
  const rawPage = Number.parseInt(params.page || '1', 10)
  const page = Number.isNaN(rawPage) ? 1 : Math.max(1, Math.min(10000, rawPage))
  const parsedLimit = parseInt(params.limit || '25', 10)
  const itemsPerPage = [25, 50, 100].includes(parsedLimit) ? parsedLimit : 25

  const [used, result] = await Promise.all([
    database.getFitnessStorageUsageForAccount({
      accountId: actor.account.id
    }),
    database.getFitnessFilesWithStatusForAccount({
      accountId: actor.account.id,
      limit: itemsPerPage,
      page
    })
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

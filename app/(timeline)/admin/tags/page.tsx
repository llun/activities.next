import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { HashtagSortOrder } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { AdminHashtagsContent } from './AdminHashtagsContent'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const sort: HashtagSortOrder =
    params.sort === 'recent' || params.sort === 'count'
      ? params.sort
      : 'alphabetical'
  const offset = Math.min((page - 1) * ITEMS_PER_PAGE, Number.MAX_SAFE_INTEGER)

  const { hashtags, total } = await database.getAllHashtags({
    limit: ITEMS_PER_PAGE,
    offset,
    sort
  })

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hashtags"
        description={`${total} hashtag${total !== 1 ? 's' : ''} in the system.`}
      />
      <AdminHashtagsContent
        hashtags={hashtags}
        sort={sort}
        page={page}
        totalPages={totalPages}
      />
    </div>
  )
}

export default Page

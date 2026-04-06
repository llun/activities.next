import { ArrowLeft, ChevronLeft, ChevronRight, Hash } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { Posts } from '@/lib/components/posts/posts'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20
const TAG_REGEX = /^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/

interface Props {
  params: Promise<{ tag: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

const Page = async ({ params, searchParams }: Props) => {
  const { tag } = await params
  if (!TAG_REGEX.test(tag)) return notFound()

  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const offset = (page - 1) * ITEMS_PER_PAGE

  const { host } = getConfig()

  const { statuses, total } = await database.getHashtagStatusesPage({
    hashtag: tag,
    limit: ITEMS_PER_PAGE,
    offset
  })

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/tags"
          aria-label="Back to hashtags list"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold">{tag}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {total} public post{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {statuses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          No public posts with #{tag}
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
          <Posts
            host={host}
            currentTime={new Date()}
            statuses={statuses.map((s) => cleanJson(s))}
            showActions={false}
          />
        </section>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              href={`/admin/tags/${tag}?page=${page - 1}`}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <span className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground/50">
              <ChevronLeft className="h-4 w-4" />
              Previous
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/admin/tags/${tag}?page=${page + 1}`}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground/50">
              Next
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default Page

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Fail to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const offset = (page - 1) * ITEMS_PER_PAGE

  const { accounts, total } = await database.getAllAccounts({
    limit: ITEMS_PER_PAGE,
    offset
  })

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          {total} account{total !== 1 ? 's' : ''} registered
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          No accounts found
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <Link
              key={account.id}
              href={`/admin/accounts/${account.id}`}
              className="flex items-center justify-between rounded-xl border bg-background/80 p-4 shadow-sm transition-colors hover:bg-muted"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">
                    {account.name || account.email}
                  </p>
                  {account.role === 'admin' && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {account.email}
                </p>
              </div>
              <div className="text-right text-sm text-muted-foreground ml-4 shrink-0">
                {new Date(account.createdAt).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              href={`/admin/accounts?page=${page - 1}`}
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
              href={`/admin/accounts?page=${page + 1}`}
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

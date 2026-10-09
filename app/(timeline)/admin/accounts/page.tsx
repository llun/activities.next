import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Pagination } from '@/lib/components/admin/Pagination'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import {
  PHONE_DETAIL_CLASS,
  SECONDARY_COLUMN_CLASS
} from '@/lib/components/admin/adminTable'
import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { Badge } from '@/lib/components/ui/badge'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const HEAD_CELL_CLASS = 'px-3 py-2.5 font-medium'

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

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
      <PageHeader
        title="Accounts"
        description={`${total} account${total !== 1 ? 's' : ''} registered.`}
      />

      {accounts.length === 0 ? (
        <EmptyState icon={ADMIN_ICONS.accounts} title="No accounts found">
          Accounts appear here once people sign up.
        </EmptyState>
      ) : (
        <TableFrame aria-label="Accounts" tableClassName="sm:min-w-[34rem]">
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
              <th scope="col" className={HEAD_CELL_CLASS}>
                Account
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Email
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Role
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Joined
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {accounts.map((account) => (
              <tr key={account.id} className="hover:bg-muted/60">
                <td className={`${TABLE_CELL_CLASS} sm:max-w-56`}>
                  <Link
                    href={`/admin/accounts/${account.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {account.name || account.email}
                  </Link>
                  <div className={PHONE_DETAIL_CLASS}>
                    <span className="min-w-0 break-all">{account.email}</span>
                    {account.role === 'admin' ? (
                      <Badge tone="primary">Admin</Badge>
                    ) : (
                      <span>Member</span>
                    )}
                    <span>
                      Joined {new Date(account.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </td>
                <td
                  className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS} text-muted-foreground max-w-64 truncate`}
                >
                  {account.email}
                </td>
                <td className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}>
                  {account.role === 'admin' ? (
                    <Badge tone="primary">Admin</Badge>
                  ) : (
                    <span className="text-muted-foreground">Member</span>
                  )}
                </td>
                <td
                  className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS} text-muted-foreground whitespace-nowrap`}
                >
                  {new Date(account.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      {totalPages > 1 && (
        <Pagination
          label={`Page ${page} of ${totalPages}`}
          previousHref={
            page > 1 ? `/admin/accounts?page=${page - 1}` : undefined
          }
          nextHref={
            page < totalPages ? `/admin/accounts?page=${page + 1}` : undefined
          }
        />
      )}
    </div>
  )
}

export default Page

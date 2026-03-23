import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMention } from '@/lib/types/domain/actor'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

const Page = async ({ params }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const { id } = await params
  const result = await database.getAccountWithActors({ accountId: id })
  if (!result) return notFound()

  const { account, actors } = result

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/accounts"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            {account.name || account.email}
          </h1>
          <p className="text-sm text-muted-foreground">{account.email}</p>
        </div>
        {account.role === 'admin' && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Admin
          </span>
        )}
      </div>

      <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Account Details</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Email</dt>
            <dd className="font-medium">{account.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Name</dt>
            <dd className="font-medium">{account.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Created</dt>
            <dd className="font-medium">
              {new Date(account.createdAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Role</dt>
            <dd className="font-medium">{account.role || 'User'}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Actors ({actors.length})</h2>
        {actors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No actors for this account
          </p>
        ) : (
          <div className="space-y-3">
            {actors.map((actor) => (
              <div
                key={actor.id}
                className="flex items-center justify-between rounded-xl border p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {actor.name || actor.username}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    {getMention(actor, true)}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground ml-4 shrink-0">
                  {actor.deletionStatus ? (
                    <span className="text-destructive">
                      {actor.deletionStatus}
                    </span>
                  ) : (
                    new Date(actor.createdAt).toLocaleDateString()
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Page

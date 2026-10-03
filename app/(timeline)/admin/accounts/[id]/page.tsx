import { notFound, redirect } from 'next/navigation'

import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { Badge } from '@/lib/components/ui/badge'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMention } from '@/lib/types/domain/actor'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { getClientActorId } from '@/lib/utils/publicId'

import { ActorModerationPanel } from './ActorModerationPanel'
import { formatAccountCreatedAt, formatAccountRole } from './accountDetails'

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
      {/* Below md the Back is its own labelled row above the heading; from
          md up it is the icon beside the heading it always was. */}
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href="/admin/accounts"
          label="Back to accounts"
          accessibleName="Back to accounts list"
          iconOnlyFrom="md"
          className="md:rounded-lg md:p-2 md:hover:bg-muted"
        />
        <PageHeader
          className="flex-1"
          title={
            <span className="flex flex-wrap items-center gap-3">
              {account.name || account.email}
              {account.role === 'admin' ? (
                <Badge tone="primary">Admin</Badge>
              ) : undefined}
            </span>
          }
          description={account.name ? account.email : undefined}
        />
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
              {formatAccountCreatedAt(account.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Role</dt>
            <dd className="font-medium">{formatAccountRole(account.role)}</dd>
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
                className="flex flex-wrap items-center justify-between rounded-xl border p-4"
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
                <div className="mt-4 basis-full border-t pt-4">
                  <ActorModerationPanel
                    actorId={getClientActorId(actor)}
                    username={actor.username}
                  />
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

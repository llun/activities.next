import { notFound, redirect } from 'next/navigation'

import { DetailList } from '@/lib/components/admin/DetailList'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
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
      {/* Below md the Back is its own "Back" row above the heading; from md
          up it is the icon beside the heading it always was. */}
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href="/admin/accounts"
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

      <Section title="Account details">
        <DetailList
          items={[
            { label: 'Email', value: account.email },
            { label: 'Name', value: account.name || '—' },
            {
              label: 'Created',
              value: formatAccountCreatedAt(account.createdAt)
            },
            { label: 'Role', value: formatAccountRole(account.role) }
          ]}
        />
      </Section>

      <Section title="Actors" meta={actors.length}>
        {actors.length === 0 ? (
          <EmptyState icon={ADMIN_ICONS.accounts} title="No actors">
            This account has no actors yet.
          </EmptyState>
        ) : (
          <FramedList aria-label="Actors">
            {actors.map((actor) => (
              <FramedListItem key={actor.id} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {actor.name || actor.username}
                    </p>
                    <p className="text-muted-foreground truncate text-sm">
                      {getMention(actor, true)}
                    </p>
                  </div>
                  <div className="text-muted-foreground shrink-0 text-right text-sm">
                    {actor.deletionStatus ? (
                      <span className="text-destructive-text">
                        {actor.deletionStatus}
                      </span>
                    ) : (
                      new Date(actor.createdAt).toLocaleDateString()
                    )}
                  </div>
                </div>
                <div className="border-t pt-4">
                  <ActorModerationPanel
                    actorId={getClientActorId(actor)}
                    username={actor.username}
                  />
                </div>
              </FramedListItem>
            ))}
          </FramedList>
        )}
      </Section>
    </div>
  )
}

export default Page

import { Trash2 } from 'lucide-react'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ComponentProps } from 'react'

import {
  addRelayAction,
  removeRelayAction,
  subscribeRelayAction,
  unsubscribeRelayAction
} from '@/app/(timeline)/admin/relays/actions'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { PageHeader } from '@/lib/components/page-header'
import { AddBar } from '@/lib/components/surface/AddBar'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { RelayState } from '@/lib/types/domain/relay'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Relays'
}

type BadgeTone = ComponentProps<typeof Badge>['tone']

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const STATUS_MESSAGES: Record<string, string> = {
  'relay-added': 'Relay added and subscription requested',
  'relay-subscribing': 'Subscription requested',
  'relay-unsubscribed': 'Unsubscribed from relay',
  'relay-removed': 'Relay removed',
  'invalid-inbox-url': 'Enter a valid relay inbox URL',
  'duplicate-inbox-url': 'A relay with that inbox URL already exists'
}

const ERROR_STATUSES = new Set(['invalid-inbox-url', 'duplicate-inbox-url'])

const STATE_BADGE_TONES: Record<RelayState, BadgeTone> = {
  idle: 'gray',
  pending: 'warning',
  accepted: 'success',
  rejected: 'destructive'
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const { status } = await searchParams
  const statusMessage = status ? (STATUS_MESSAGES[status] ?? null) : null
  const isErrorStatus = status ? ERROR_STATUSES.has(status) : false

  const relays = await database.getRelays()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relays"
        description="Relays distribute your public posts to other servers and bring their public posts back, so you can federate with instances you do not directly follow."
      />

      {statusMessage && (
        <Alert
          tone={isErrorStatus ? 'error' : 'success'}
          title={statusMessage}
        />
      )}

      <Section title="Add relay">
        <AddBar
          action={addRelayAction}
          label="Inbox URL"
          id="relay-inbox-url"
          buttonLabel="Add relay"
          hint="The relay's inbox, usually ending in /inbox."
          inputProps={{
            required: true,
            type: 'url',
            name: 'inboxUrl',
            placeholder: 'https://relay.example/inbox'
          }}
        />
      </Section>

      <Section
        title="Relays"
        meta={relays.length > 0 ? relays.length : undefined}
      >
        {relays.length === 0 ? (
          <EmptyState icon={ADMIN_ICONS.relays} title="No relays configured">
            Add a relay above to start sharing public posts with other servers.
          </EmptyState>
        ) : (
          <FramedList aria-label="Relays">
            {relays.map((relay) => {
              const canSubscribe =
                relay.state === 'idle' || relay.state === 'rejected'

              return (
                <FramedListItem
                  key={relay.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{relay.inboxUrl}</p>
                      <Badge
                        tone={STATE_BADGE_TONES[relay.state]}
                        className="shrink-0 capitalize"
                      >
                        {relay.state}
                      </Badge>
                    </div>
                    {relay.actorId && (
                      <p className="text-muted-foreground truncate text-sm">
                        {relay.actorId}
                      </p>
                    )}
                    {relay.lastError && (
                      <p className="text-destructive-text truncate text-sm">
                        {relay.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canSubscribe ? (
                      <form action={subscribeRelayAction}>
                        <input type="hidden" name="id" value={relay.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Subscribe
                        </Button>
                      </form>
                    ) : (
                      <form action={unsubscribeRelayAction}>
                        <input type="hidden" name="id" value={relay.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Unsubscribe
                        </Button>
                      </form>
                    )}
                    <form action={removeRelayAction}>
                      <input type="hidden" name="id" value={relay.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove relay ${relay.inboxUrl}`}
                      >
                        <Trash2 />
                      </Button>
                    </form>
                  </div>
                </FramedListItem>
              )
            })}
          </FramedList>
        )}
      </Section>
    </div>
  )
}

export default Page

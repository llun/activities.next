import { Trash2 } from 'lucide-react'
import { redirect } from 'next/navigation'

import {
  addRelayAction,
  removeRelayAction,
  subscribeRelayAction,
  unsubscribeRelayAction
} from '@/app/(timeline)/admin/relays/actions'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { RelayState } from '@/lib/types/domain/relay'
import { cn } from '@/lib/utils'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

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

const STATE_BADGE_CLASSES: Record<RelayState, string> = {
  idle: 'border-border bg-muted text-muted-foreground',
  pending:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
  accepted:
    'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100',
  rejected:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
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
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            isErrorStatus
              ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
              : 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100'
          )}
        >
          {statusMessage}
        </div>
      )}

      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Add relay</h2>
        <form action={addRelayAction} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="relay-inbox-url">Inbox URL</Label>
            <Input
              id="relay-inbox-url"
              required
              type="url"
              name="inboxUrl"
              placeholder="https://relay.example/inbox"
            />
          </div>
          <Button type="submit">Add relay</Button>
        </form>
      </section>

      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Relays</h2>
        <div className="space-y-2">
          {relays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No relays configured
            </p>
          ) : (
            relays.map((relay) => {
              const canSubscribe =
                relay.state === 'idle' || relay.state === 'rejected'

              return (
                <div
                  key={relay.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{relay.inboxUrl}</p>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                          STATE_BADGE_CLASSES[relay.state]
                        )}
                      >
                        {relay.state}
                      </span>
                    </div>
                    {relay.actorId && (
                      <p className="truncate text-sm text-muted-foreground">
                        {relay.actorId}
                      </p>
                    )}
                    {relay.lastError && (
                      <p className="truncate text-sm text-destructive">
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
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

export default Page

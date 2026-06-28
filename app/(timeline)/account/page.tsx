import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AccountIdentityCard } from '@/app/(timeline)/account/AccountIdentityCard'
import { ChangeEmailForm } from '@/app/(timeline)/account/ChangeEmailForm'
import { ChangeNameForm } from '@/app/(timeline)/account/ChangeNameForm'
import { PageHeader } from '@/lib/components/page-header'
import { ActorsSection } from '@/lib/components/settings/ActorsSection'
import { ImageUploadField } from '@/lib/components/settings/ImageUploadField'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Account'
}

const Page = async ({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const account = actor.account
  const { error } = await searchParams
  const actors = await database.getActorsForAccount({
    accountId: account.id
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="General"
        description="Your account identity and the actors it contains. These details are shared by every actor."
      />

      <AccountIdentityCard
        name={account.name}
        email={account.email}
        iconUrl={account.iconUrl}
      />

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Actors</h2>
          <p className="text-sm text-muted-foreground">
            Every actor below shares this account&apos;s email, password, and
            security. Switch between them, or set the one you sign in as by
            default.
          </p>
        </div>
        <ActorsSection
          currentActor={{
            id: actor.id,
            username: actor.username,
            domain: actor.domain,
            name: actor.name,
            iconUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : null,
            deletionStatus: actor.deletionStatus ?? null,
            deletionScheduledAt: actor.deletionScheduledAt ?? null
          }}
          actors={actors.map((actorItem) => ({
            id: actorItem.id,
            username: actorItem.username,
            domain: actorItem.domain,
            name: actorItem.name,
            iconUrl: isRealAvatar(actorItem.iconUrl) ? actorItem.iconUrl : null,
            deletionStatus: actorItem.deletionStatus ?? null,
            deletionScheduledAt: actorItem.deletionScheduledAt ?? null
          }))}
          currentDefault={account.defaultActorId || null}
        />
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Full name</h2>
          <p className="text-sm text-muted-foreground">
            Your account display name used across services.
          </p>
        </div>
        <ChangeNameForm currentName={account.name || ''} />
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Profile image</h2>
          <p className="text-sm text-muted-foreground">
            Your account avatar, shown in admin and account lists.
          </p>
        </div>
        <form
          action="/api/v1/accounts/image"
          method="post"
          className="space-y-4"
        >
          <ImageUploadField
            fieldName="iconUrl"
            currentUrl={account.iconUrl || null}
            label="Profile image"
            placeholder="https://example.com/avatar.jpg"
            previewType="thumbnail"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit">Update</Button>
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Email address</h2>
          <p className="text-sm text-muted-foreground">
            Used for sign-in and account notifications.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Current email</Label>
          <div className="flex items-center gap-2">
            <Input value={account.email} disabled className="bg-muted" />
            {account.emailVerifiedAt && (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                Verified
              </span>
            )}
          </div>
        </div>

        <ChangeEmailForm currentEmail={account.email} />
      </section>
    </div>
  )
}

export default Page

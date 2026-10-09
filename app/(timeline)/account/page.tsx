import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AccountIdentityCard } from '@/app/(timeline)/account/AccountIdentityCard'
import { ChangeEmailForm } from '@/app/(timeline)/account/ChangeEmailForm'
import { ChangeNameForm } from '@/app/(timeline)/account/ChangeNameForm'
import { PageHeader } from '@/lib/components/page-header'
import { ActorsSection } from '@/lib/components/settings/ActorsSection'
import { ImageUploadField } from '@/lib/components/settings/ImageUploadField'
import { NativeFormSaveBar } from '@/lib/components/settings/NativeFormSaveBar'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Badge } from '@/lib/components/ui/badge'
import { Input } from '@/lib/components/ui/input'
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
        iconUrl={isRealAvatar(account.iconUrl) ? account.iconUrl : null}
      />

      <Section
        title="Actors"
        description="Every actor below shares this account’s email, password, and security. Switch between them, or set the one you sign in as by default."
      >
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
      </Section>

      <Section
        title="Full name"
        description="Your account display name used across services."
      >
        <ChangeNameForm currentName={account.name || ''} />
      </Section>

      <Section
        title="Profile image"
        description="Your account avatar, shown in admin and account lists."
      >
        {error && <Alert title={error} />}
        <form action="/api/v1/accounts/image" method="post">
          <Frame footer={<NativeFormSaveBar />}>
            <ImageUploadField
              fieldName="iconUrl"
              currentUrl={account.iconUrl || null}
              label="Profile image"
              previewType="thumbnail"
            />
          </Frame>
        </form>
      </Section>

      <Section
        title="Email address"
        description="Used for sign-in and account notifications."
      >
        <Frame divided className="overflow-hidden">
          <FormRow label="Current email" htmlFor="currentEmail">
            <div className="flex items-center gap-2">
              <Input
                id="currentEmail"
                value={account.email}
                disabled
                className="bg-muted"
              />
              {account.emailVerifiedAt && (
                <Badge tone="success">Verified</Badge>
              )}
            </div>
          </FormRow>
          <ChangeEmailForm currentEmail={account.email} />
        </Frame>
      </Section>
    </div>
  )
}

export default Page

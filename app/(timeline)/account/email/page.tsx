import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ChangeEmailForm } from '@/app/(timeline)/account/ChangeEmailForm'
import { ChangeNameForm } from '@/app/(timeline)/account/ChangeNameForm'
import { PageHeader } from '@/lib/components/page-header'
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

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Email & name'
}

const EditProfileLink = () => (
  <Link href="/settings/profile" className="underline">
    Edit profile
  </Link>
)

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email & name"
        description="Used for sign-in and account emails, shared by every profile."
      />

      <Section
        title="Email address"
        description="Used for sign-in and account notifications."
      >
        <ChangeEmailForm currentEmail={account.email}>
          <FormRow label="Current email" htmlFor="currentEmail">
            <div className="flex items-center gap-2">
              <Input id="currentEmail" value={account.email} disabled />
              {account.emailVerifiedAt && (
                <Badge tone="success">Verified</Badge>
              )}
            </div>
          </FormRow>
        </ChangeEmailForm>
      </Section>

      <Section
        title="Account name"
        description={
          <>
            The name on your account, used in admin and account lists. Each
            profile has its own name in <EditProfileLink />.
          </>
        }
      >
        <ChangeNameForm currentName={account.name || ''} />
      </Section>

      <Section
        title="Account photo"
        description={
          <>
            Shown in admin and account lists. Each profile has its own photo in{' '}
            <EditProfileLink />.
          </>
        }
      >
        {error && <Alert title={error} />}
        <form action="/api/v1/accounts/image" method="post">
          <Frame form footer={<NativeFormSaveBar />}>
            <ImageUploadField
              fieldName="iconUrl"
              currentUrl={account.iconUrl || null}
              label="Account photo"
              previewType="thumbnail"
            />
          </Frame>
        </form>
      </Section>
    </div>
  )
}

export default Page

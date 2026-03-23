import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AuthenticationProviders } from '@/app/(timeline)/settings/AuthenticationProviders'
import { LogoutButton } from '@/app/(timeline)/settings/LogoutButton'
import { ImageUploadField } from '@/lib/components/settings/ImageUploadField'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ChangeEmailForm } from './ChangeEmailForm'
import { ChangeNameForm } from './ChangeNameForm'
import { ChangePasswordForm } from './ChangePasswordForm'
import { PasskeyManager } from './PasskeyManager'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Account Settings'
}

const Page = async ({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const account = actor.account
  const { error } = await searchParams
  const { auth } = getConfig()
  const [nonCredentialsProviders, connectedProviders] = await Promise.all([
    auth?.github ? [{ id: 'github', name: 'GitHub' }] : [],
    database.getAccountProviders({ accountId: account.id })
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Account Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account details, email and password.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Full Name</h2>
          <p className="text-sm text-muted-foreground">
            Your account display name used across services.
          </p>
        </div>
        <ChangeNameForm currentName={account.name || ''} />
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Profile Image</h2>
          <p className="text-sm text-muted-foreground">
            Your account avatar used in admin and account lists.
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
          <h2 className="text-lg font-semibold">Email Address</h2>
          <p className="text-sm text-muted-foreground">
            Your email is used for login and notifications.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Current Email</Label>
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

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Password</h2>
          <p className="text-sm text-muted-foreground">
            Change your password to keep your account secure.
          </p>
        </div>

        <ChangePasswordForm />
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Passkeys</h2>
          <p className="text-sm text-muted-foreground">
            Use biometrics or a hardware key to sign in without a password.
          </p>
        </div>
        <PasskeyManager />
      </section>

      {nonCredentialsProviders.length > 0 && (
        <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Connected Accounts</h2>
            <p className="text-sm text-muted-foreground">
              Manage login methods.
            </p>
          </div>
          <AuthenticationProviders
            nonCredentialsProviders={nonCredentialsProviders}
            connectedProviders={connectedProviders}
          />
        </section>
      )}

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Session</h2>
          <p className="text-sm text-muted-foreground">
            Manage your current session.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Sign out from this account on this device.
          </p>
          <LogoutButton />
        </div>
      </section>
    </div>
  )
}

export default Page

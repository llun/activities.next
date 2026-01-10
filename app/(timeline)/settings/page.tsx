import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { getProviders } from 'next-auth/react'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Textarea } from '@/lib/components/ui/textarea'
import { getDatabase } from '@/lib/database'
import { getActorProfile } from '@/lib/models/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthenticationProviders } from './AuthenticationProviders'
import { LogoutButton } from './LogoutButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Settings'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const [session, providers] = await Promise.all([
    getServerSession(getAuthOptions()),
    getProviders()
  ])

  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const profile = getActorProfile(actor)
  const nonCredentialsProviders =
    (providers &&
      Object.values(providers).filter(
        (provider) => provider.id !== 'credentials'
      )) ||
    []
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and account settings.
        </p>
      </div>

      <form action="/api/v1/accounts/profile" method="post">
        <section className="mb-6 space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Profile</h2>
            <p className="text-sm text-muted-foreground">
              Public information visible on your profile.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nameInput">Name</Label>
            <Input
              type="text"
              id="nameInput"
              name="name"
              aria-describedby="nameHelp"
              defaultValue={profile.name || ''}
              placeholder="Your display name"
            />
            <p id="nameHelp" className="text-[0.8rem] text-muted-foreground">
              Name that you want to show in profile
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="summaryInput">Summary</Label>
            <Textarea
              rows={3}
              name="summary"
              id="summaryInput"
              defaultValue={profile.summary || ''}
              placeholder="A brief description about yourself"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="iconInput">Icon Image URL</Label>
            <Input
              type="text"
              name="iconUrl"
              id="iconInput"
              aria-describedby="iconHelp"
              defaultValue={profile.iconUrl || ''}
              placeholder="https://example.com/avatar.jpg"
            />
            <p id="iconHelp" className="text-[0.8rem] text-muted-foreground">
              Image URL for profile
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="headerImageInput">Header Image URL</Label>
            <Input
              type="text"
              id="headerImageInput"
              name="headerImageUrl"
              aria-describedby="headerImageHelp"
              defaultValue={profile.headerImageUrl || ''}
              placeholder="https://example.com/header.jpg"
            />
            <p
              id="headerImageHelp"
              className="text-[0.8rem] text-muted-foreground"
            >
              Image URL for profile header
            </p>
          </div>
        </section>

        <section className="mb-6 space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Privacy</h2>
            <p className="text-sm text-muted-foreground">
              Control who can follow you.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="manuallyApprovesFollowersInput">
                Manually approve followers
              </Label>
              <p className="text-[0.8rem] text-muted-foreground">
                When enabled, you must manually approve each follow request
              </p>
            </div>
            <input
              type="checkbox"
              id="manuallyApprovesFollowersInput"
              name="manuallyApprovesFollowers"
              defaultChecked={profile.manuallyApprovesFollowers ?? true}
              className="h-4 w-4 rounded border-gray-300"
            />
          </div>
        </section>

        <section className="mb-6 space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Integrations</h2>
            <p className="text-sm text-muted-foreground">
              Connect with other services.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="appleSharedAlbumTokenInput">
              Apple Shared Album Token
            </Label>
            <Input
              type="text"
              id="appleSharedAlbumTokenInput"
              name="appleSharedAlbumToken"
              aria-describedby="appleSharedAlbumTokenHelp"
              defaultValue={profile.appleSharedAlbumToken || ''}
              placeholder="Enter your Apple Shared Album token"
            />
            <p
              id="appleSharedAlbumTokenHelp"
              className="text-[0.8rem] text-muted-foreground"
            >
              Apple Shared Album tokens contains images (and videos) that you
              want to post with
            </p>
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="submit">Update</Button>
        </div>
      </form>

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
          />
        </section>
      )}

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Account</h2>
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

import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { getProviders } from 'next-auth/react'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { ActorSwitcherSection } from '@/lib/components/settings/ActorSwitcherSection'
import { DefaultActorSelector } from '@/lib/components/settings/DefaultActorSelector'
import { DeleteActorSection } from '@/lib/components/settings/DeleteActorSection'
import { ImageUploadField } from '@/lib/components/settings/ImageUploadField'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Textarea } from '@/lib/components/ui/textarea'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorProfile } from '@/lib/models/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthenticationProviders } from './AuthenticationProviders'
import { LogoutButton } from './LogoutButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Settings'
}

const isRealAvatar = (url?: string) => {
  if (!url) return false
  if (url.includes('gravatar')) return false
  if (url.includes('ui-avatars')) return false
  if (url.includes('robohash')) return false
  if (url.includes('dicebear')) return false
  if (url.includes('boringavatars')) return false
  if (url.includes('default')) return false
  if (url.includes('placeholder')) return false
  return true
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
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const profile = getActorProfile(actor)
  const { auth } = getConfig()
  const [nonCredentialsProviders, connectedProviders, actors] =
    await Promise.all([
      (providers &&
        Object.values(providers).filter((provider) => {
          if (provider.id === 'credentials') return false
          if (provider.id === 'github' && !auth?.github) return false
          return true
        })) ||
        [],
      database.getAccountProviders({ accountId: actor.account.id }),
      database.getActorsForAccount({ accountId: actor.account.id })
    ])
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
            <Label>Handle</Label>
            <Input
              value={`@${profile.username}@${profile.domain}`}
              disabled
              className="bg-muted"
            />
            <p className="text-[0.8rem] text-muted-foreground">
              Your unique identifier on the fediverse
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

          <ImageUploadField
            fieldName="iconUrl"
            currentUrl={profile.iconUrl || null}
            label="Icon image"
            placeholder="https://example.com/avatar.jpg"
            previewType="thumbnail"
          />

          <ImageUploadField
            fieldName="headerImageUrl"
            currentUrl={profile.headerImageUrl || null}
            label="Header image"
            placeholder="https://example.com/header.jpg"
            previewType="landscape"
          />
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
              type="hidden"
              name="manuallyApprovesFollowers_marker"
              value="true"
            />
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

      {actors.length > 1 && (
        <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Switch Actor</h2>
            <p className="text-sm text-muted-foreground">
              Switch between your actors or create a new one.
            </p>
          </div>
          <ActorSwitcherSection
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
          />
        </section>
      )}

      {actors.length > 1 && (
        <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Default Actor</h2>
            <p className="text-sm text-muted-foreground">
              Choose which actor to use when signing in.
            </p>
          </div>
          <DefaultActorSelector
            actors={actors.map((a) => ({
              id: a.id,
              username: a.username,
              domain: a.domain,
              name: a.name,
              iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null
            }))}
            currentDefault={actor.account.defaultActorId || null}
          />
        </section>
      )}

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

      <section className="space-y-4 rounded-2xl border border-destructive/20 bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-destructive">
            Danger Zone
          </h2>
          <p className="text-sm text-muted-foreground">
            Irreversible actions for this actor.
          </p>
        </div>
        <DeleteActorSection
          actorId={actor.id}
          actorUsername={actor.username}
          actorDomain={actor.domain}
          isDefaultActor={actor.account.defaultActorId === actor.id}
          isOnlyActor={actors.filter((a) => !a.deletionStatus).length <= 1}
          deletionStatus={actor.deletionStatus ?? null}
        />
      </section>
    </div>
  )
}

export default Page

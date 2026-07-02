import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { DeleteActorSection } from '@/lib/components/settings/DeleteActorSection'
import { ImageUploadField } from '@/lib/components/settings/ImageUploadField'
import { ThemeControl } from '@/lib/components/theme'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Settings'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const profile = getActorProfile(actor)
  const settings = await database.getActorSettings({ actorId: actor.id })
  const actors = await database.getActorsForAccount({
    accountId: actor.account.id
  })
  return (
    <div className="space-y-6">
      <PageHeader
        title="General"
        description="Profile, appearance, and privacy for this actor."
      />

      <form action="/api/v1/accounts/profile" method="post">
        <section className="mb-6 space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Appearance</h2>
            <p className="text-sm text-muted-foreground">
              Theme for this device, and how posts appear on your timeline.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Theme</div>
            {/* Device-local preference (persisted in localStorage), so it saves
                instantly and sits outside the Update/Cancel form flow below. */}
            <ThemeControl variant="full" />
            <p className="text-[0.8rem] text-muted-foreground">
              System follows this device&apos;s setting. Saved instantly on this
              device — no Update needed.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="postLineLimitInput">Post line limit</Label>
            <select
              id="postLineLimitInput"
              name="postLineLimit"
              defaultValue={String(settings?.postLineLimit ?? 5)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="5">5 lines</option>
              <option value="10">10 lines</option>
              <option value="0">No limit</option>
            </select>
            <p className="text-[0.8rem] text-muted-foreground">
              Number of lines to show before a &quot;Show more&quot; button
              appears. Set to &quot;No limit&quot; to always show full post
              content.
            </p>
          </div>
        </section>

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
            <Switch
              id="manuallyApprovesFollowersInput"
              name="manuallyApprovesFollowers"
              defaultChecked={profile.manuallyApprovesFollowers ?? true}
            />
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="submit">Update</Button>
        </div>
      </form>

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

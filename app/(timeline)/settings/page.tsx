import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { AppearanceSection } from '@/lib/components/settings/AppearanceSection'
import { DeleteActorSection } from '@/lib/components/settings/DeleteActorSection'
import { ImageUploadField } from '@/lib/components/settings/ImageUploadField'
import { NativeFormSaveBar } from '@/lib/components/settings/NativeFormSaveBar'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
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

      <form
        action="/api/v1/accounts/profile"
        method="post"
        className="space-y-6"
      >
        <AppearanceSection>
          <FormRow
            label="Post line limit"
            htmlFor="postLineLimitInput"
            hint="Number of lines to show before a “Show more” button appears. Set to “No limit” to always show full post content."
          >
            {({ describedBy }) => (
              <Select
                id="postLineLimitInput"
                name="postLineLimit"
                aria-describedby={describedBy}
                defaultValue={String(settings?.postLineLimit ?? 5)}
              >
                <option value="5">5 lines</option>
                <option value="10">10 lines</option>
                <option value="0">No limit</option>
              </Select>
            )}
          </FormRow>
        </AppearanceSection>

        <Section
          title="Profile"
          description="Public information visible on your profile."
        >
          <Frame divided>
            <FormRow
              label="Handle"
              htmlFor="handleInput"
              hint="Your unique identifier on the fediverse"
            >
              {({ describedBy }) => (
                <Input
                  id="handleInput"
                  aria-describedby={describedBy}
                  value={`@${profile.username}@${profile.domain}`}
                  disabled
                />
              )}
            </FormRow>
            <FormRow
              label="Name"
              htmlFor="nameInput"
              hint="Name that you want to show in profile"
            >
              {({ describedBy }) => (
                <Input
                  type="text"
                  id="nameInput"
                  name="name"
                  aria-describedby={describedBy}
                  defaultValue={profile.name || ''}
                  placeholder="Your display name"
                />
              )}
            </FormRow>
            <FormRow label="Summary" htmlFor="summaryInput">
              <Textarea
                rows={3}
                name="summary"
                id="summaryInput"
                defaultValue={profile.summary || ''}
                placeholder="A brief description about yourself"
              />
            </FormRow>
            <ImageUploadField
              fieldName="iconUrl"
              currentUrl={profile.iconUrl || null}
              label="Icon image"
              previewType="thumbnail"
            />
            <ImageUploadField
              fieldName="headerImageUrl"
              currentUrl={profile.headerImageUrl || null}
              label="Header image"
              previewType="landscape"
            />
          </Frame>
        </Section>

        <Section title="Privacy" description="Control who can follow you.">
          <Frame divided>
            <FormRow
              label="Manually approve followers"
              htmlFor="manuallyApprovesFollowersInput"
              hint="When enabled, you must manually approve each follow request"
              inline
            >
              {({ describedBy }) => (
                <>
                  <input
                    type="hidden"
                    name="manuallyApprovesFollowers_marker"
                    value="true"
                  />
                  <Switch
                    id="manuallyApprovesFollowersInput"
                    name="manuallyApprovesFollowers"
                    aria-describedby={describedBy}
                    defaultChecked={profile.manuallyApprovesFollowers ?? true}
                  />
                </>
              )}
            </FormRow>
          </Frame>
        </Section>

        {/* One form spans several Sections, so the bar stays in reach. */}
        <div className="sticky bottom-0 z-10 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Frame className="px-4 py-3">
            <NativeFormSaveBar />
          </Frame>
        </div>
      </form>

      <Section
        title="Danger zone"
        description="Irreversible actions for this actor."
      >
        <DeleteActorSection
          actorId={actor.id}
          actorUsername={actor.username}
          actorDomain={actor.domain}
          isDefaultActor={actor.account.defaultActorId === actor.id}
          isOnlyActor={actors.filter((a) => !a.deletionStatus).length <= 1}
          deletionStatus={actor.deletionStatus ?? null}
        />
      </Section>
    </div>
  )
}

export default Page

import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { AppearanceSection } from '@/lib/components/settings/AppearanceSection'
import { DeleteActorSection } from '@/lib/components/settings/DeleteActorSection'
import { NativeFormSaveBar } from '@/lib/components/settings/NativeFormSaveBar'
import { Alert } from '@/lib/components/surface/Alert'
import { FormGroup } from '@/lib/components/surface/FormGroup'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings'
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
        description="Appearance, timeline and who can follow you."
      />

      {/* A standing pointer, not news: the profile fields moved to their own
          page. It sits in the page stack, beside the boxes. */}
      <Alert
        tone="info"
        live={false}
        title="Looking for your name, bio or profile fields?"
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/profile">Edit profile</Link>
          </Button>
        }
      >
        They moved to Edit profile, together with featured hashtags.
      </Alert>

      <AppearanceSection />

      <form
        action="/api/v1/accounts/profile"
        method="post"
        className="space-y-6"
      >
        <Frame form stickyFooter footer={<NativeFormSaveBar />}>
          <FormGroup
            title="Timeline"
            description="How posts appear on your timeline."
          >
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
          </FormGroup>

          <FormGroup title="Privacy" description="Control who can follow you.">
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
          </FormGroup>
        </Frame>
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

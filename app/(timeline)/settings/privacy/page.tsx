import { Activity, ChevronRight, Images } from 'lucide-react'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { NativeFormSaveBar } from '@/lib/components/settings/NativeFormSaveBar'
import { FormGroup } from '@/lib/components/surface/FormGroup'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { Switch } from '@/lib/components/ui/switch'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getVisitedFeatures } from '@/lib/services/domains/visitedFeatures'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getActorProfile } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Privacy'
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

  const serverSettings = await getResolvedServerSettings(database)
  const features = await getVisitedFeatures(serverSettings.features)

  const profile = getActorProfile(actor)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy"
        description="Who can follow you and find your posts. Blocks, mutes and filters are next to this in the list."
      />

      <form action="/api/v1/accounts/profile" method="post">
        <input type="hidden" name="returnTo" value="/settings/privacy" />
        <Frame form stickyFooter footer={<NativeFormSaveBar />}>
          <FormGroup
            title="Followers"
            description="Control who can follow you."
          >
            <FormRow
              label="Manually approve followers"
              htmlFor="manuallyApprovesFollowersInput"
              hint="When on, you approve each follow request."
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
          <FormGroup
            title="Search"
            description="Whether your posts can be found by the words in them."
          >
            <FormRow
              label="Include my public posts in search results"
              htmlFor="indexableInput"
              hint="When on, people signed in here can find your public posts by their words, and other servers that honour this setting may too. Unlisted, followers-only and direct posts never appear."
              inline
            >
              {({ describedBy }) => (
                <>
                  <input type="hidden" name="indexable_marker" value="true" />
                  <Switch
                    id="indexableInput"
                    name="indexable"
                    aria-describedby={describedBy}
                    defaultChecked={actor.indexable === true}
                  />
                </>
              )}
            </FormRow>
          </FormGroup>
        </Frame>
      </form>

      <Section
        title="Location privacy"
        description={
          features.fitness
            ? 'Set in Fitness and Gallery, where the places are.'
            : 'Set in Gallery, where the places are.'
        }
      >
        <FramedList>
          {features.fitness ? (
            <FramedListItem
              href="/fitness/privacy"
              className="flex items-center gap-3 text-sm font-medium"
            >
              <Activity
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex-1">Fitness privacy</span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </FramedListItem>
          ) : null}
          <FramedListItem
            href="/gallery/privacy"
            className="flex items-center gap-3 text-sm font-medium"
          >
            <Images
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="flex-1">Gallery privacy</span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </FramedListItem>
        </FramedList>
      </Section>
    </div>
  )
}

export default Page

import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { AppearanceSection } from '@/lib/components/settings/AppearanceSection'
import { NativeFormSaveBar } from '@/lib/components/settings/NativeFormSaveBar'
import { FormGroup } from '@/lib/components/surface/FormGroup'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Select } from '@/lib/components/ui/select'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Appearance'
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

  const settings = await database.getActorSettings({ actorId: actor.id })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appearance"
        description="The theme on this device, and how much of each post your timeline shows."
      />

      <AppearanceSection />

      <form action="/api/v1/accounts/profile" method="post">
        <input type="hidden" name="returnTo" value="/settings/appearance" />
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
        </Frame>
      </form>
    </div>
  )
}

export default Page

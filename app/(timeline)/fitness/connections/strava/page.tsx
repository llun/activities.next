import { redirect } from 'next/navigation'
import { FC } from 'react'

import { Card } from '@/lib/components/ui/card'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { StravaGearDefaultsSection } from './StravaGearDefaultsSection'
import { StravaSettingsForm } from './StravaSettingsForm'

export const dynamic = 'force-dynamic'

const StravaPage: FC = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const actorHandle = getMention(getActorProfile(actor), true)

  return (
    <div className="space-y-6">
      <StravaSettingsForm serverActorHandle={actorHandle} />

      <Card className="p-6">
        <StravaGearDefaultsSection />
      </Card>
    </div>
  )
}

export default StravaPage

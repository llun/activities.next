import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Card } from '@/lib/components/ui/card'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { StravaSettingsForm } from './StravaSettingsForm'

export const dynamic = 'force-dynamic'

const StravaPage: FC = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  const actorHandle = actor
    ? getMention(getActorProfile(actor), true)
    : undefined

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strava Integration"
        description={
          <>
            Connect your Strava account to sync fitness activities. You&apos;ll
            need to create an application in the{' '}
            <a
              href="https://www.strava.com/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Strava API settings
            </a>
            . You can also import historical activities from a Strava export
            archive.
          </>
        }
      />

      <Card className="p-6">
        <StravaSettingsForm serverActorHandle={actorHandle} />
      </Card>
    </div>
  )
}

export default StravaPage

import { FC } from 'react'

import { Card } from '@/lib/components/ui/card'

import { StravaSettingsForm } from './StravaSettingsForm'

export const dynamic = 'force-dynamic'

const StravaPage: FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Strava Integration</h1>
        <p className="mt-2 text-muted-foreground">
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
          .
        </p>
      </div>

      <Card className="p-6">
        <StravaSettingsForm />
      </Card>
    </div>
  )
}

export default StravaPage

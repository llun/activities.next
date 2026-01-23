import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { ActorSelector } from '@/lib/components/settings/ActorSelector'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Settings'
}

interface PageProps {
  searchParams: Promise<{ actorId?: string }>
}

const Page = async ({ searchParams }: PageProps) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  // Get all actors for this account
  const actors = await database.getActorsForAccount({
    accountId: actor.account.id
  })

  // Determine which actor's settings to display
  const params = await searchParams
  const selectedActorId = params.actorId || actor.id
  const selectedActor = actors.find((a) => a.id === selectedActorId) || actor

  // Get current Strava settings
  const settings = await database.getActorSettings({
    actorId: selectedActor.id
  })
  const stravaIntegration = settings?.stravaIntegration || {}

  // Generate webhook URL with random ID if not already present
  const webhookId = stravaIntegration.webhookId || Math.random().toString(36).substring(2, 15)
  const host = process.env.ACTIVITIES_HOST || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const webhookUrl = `${protocol}://${host}/api/webhooks/strava/${webhookId}`

  const isConfigured = !!(stravaIntegration.clientId && stravaIntegration.clientSecret)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fitness Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect your fitness tracking services to automatically share your
          activities.
        </p>
      </div>

      <form action="/api/v1/accounts/strava-settings" method="post">
        <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Strava Integration</h2>
            <p className="text-sm text-muted-foreground">
              Connect your Strava account to automatically post your activities
              to your timeline.
            </p>
          </div>

          <ActorSelector actors={actors} selectedActorId={selectedActor.id} />

          {isConfigured && (
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-400">
              ✓ Strava is configured and{' '}
              {stravaIntegration.enabled ? 'enabled' : 'disabled'}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                type="text"
                id="clientId"
                name="clientId"
                defaultValue={stravaIntegration.clientId || ''}
                placeholder="Your Strava application client ID"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Create a Strava API application at{' '}
                <a
                  href="https://www.strava.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  strava.com/settings/api
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client Secret</Label>
              <Input
                type="password"
                id="clientSecret"
                name="clientSecret"
                defaultValue={stravaIntegration.clientSecret || ''}
                placeholder="Your Strava application client secret"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  id="webhookUrl"
                  name="webhookUrl"
                  value={webhookUrl}
                  readOnly
                  className="font-mono text-sm bg-muted"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl)
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this URL as your webhook callback URL in your Strava
                application settings. This URL is unique to your account.
              </p>
              <input type="hidden" name="webhookId" value={webhookId} />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="enabled" className="cursor-pointer">
                  Enable Integration
                </Label>
                <p className="text-[0.8rem] text-muted-foreground">
                  When enabled, new Strava activities will be posted to your
                  timeline
                </p>
              </div>
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
                defaultChecked={stravaIntegration.enabled}
                className="h-4 w-4 rounded border-gray-300"
              />
            </div>
          </div>
        </section>

        <div className="flex justify-end mt-6">
          <Button type="submit">Save Settings</Button>
        </div>
      </form>
    </div>
  )
}

export default Page

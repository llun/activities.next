'use client'

import { FC, useEffect, useState } from 'react'

import {
  deleteStravaSettings,
  getStravaSettings,
  saveStravaSettings
} from '@/lib/client'
import { VisibilitySelector } from '@/lib/components/post-box/visibility-selector'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Visibility as MastodonVisibilitySchema } from '@/lib/types/mastodon/visibility'
import type { Visibility as MastodonVisibility } from '@/lib/types/mastodon/visibility'

import { StravaArchiveImportSection } from './StravaArchiveImportSection'

interface StravaSettingsFormProps {
  serverActorHandle?: string
}

const DEFAULT_STRAVA_VISIBILITY: MastodonVisibility = 'private'

const isMastodonVisibility = (value: unknown): value is MastodonVisibility => {
  return MastodonVisibilitySchema.safeParse(value).success
}

const isAbortError = (err: unknown) =>
  Boolean(
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError')
  )

export const StravaSettingsForm: FC<StravaSettingsFormProps> = ({
  serverActorHandle
}) => {
  const [clientId, setClientId] = useState('')

  const [clientSecret, setClientSecret] = useState('')
  const [isConfigured, setIsConfigured] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{
    tone: 'info' | 'success'
    text: string
  } | null>(null)
  const [error, setError] = useState('')
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false)
  const [archiveActorHandle, setArchiveActorHandle] = useState('')
  const [defaultVisibility, setDefaultVisibility] =
    useState<MastodonVisibility>(DEFAULT_STRAVA_VISIBILITY)

  useEffect(() => {
    const controller = new AbortController()
    const fetchSettings = async () => {
      try {
        const data = await getStravaSettings({ signal: controller.signal })

        if (data.configured) {
          setIsConfigured(true)
          setIsConnected(data.connected || false)
          setClientId(data.clientId || '')
          setClientSecret('••••••••')
          setWebhookUrl(data.webhookUrl || '')
        }
        if (isMastodonVisibility(data.defaultVisibility)) {
          setDefaultVisibility(data.defaultVisibility)
        }
        if (
          typeof data.actorHandle === 'string' &&
          data.actorHandle.length > 0
        ) {
          setArchiveActorHandle(data.actorHandle)
        } else if (serverActorHandle) {
          setArchiveActorHandle(serverActorHandle)
        }
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) {
          return
        }
        setError('Failed to load settings')
      }
    }

    const checkUrlParams = () => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('success') === 'true') {
        setMessage({
          tone: 'success',
          text: 'Successfully connected to Strava!'
        })
        setIsConnected(true)
        window.history.replaceState(
          {},
          '',
          window.location.pathname + window.location.hash
        )
      } else if (params.get('error')) {
        const errorType = params.get('error')
        setError(
          errorType === 'authorization_failed'
            ? 'Authorization was denied or failed'
            : errorType === 'webhook_subscription_failed'
              ? 'Failed to create webhook subscription. Please try again.'
              : 'Failed to connect to Strava'
        )
        window.history.replaceState(
          {},
          '',
          window.location.pathname + window.location.hash
        )
      }
    }

    const loadInitialState = async () => {
      await fetchSettings()
      checkUrlParams()
    }

    void loadInitialState()

    return () => {
      controller.abort()
    }
  }, [serverActorHandle])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage(null)
    setIsLoading(true)

    try {
      const data = await saveStravaSettings(
        isConfigured
          ? { defaultVisibility }
          : { clientId, clientSecret, defaultVisibility }
      )

      setIsConfigured(true)
      if (!isConfigured) {
        setClientSecret('••••••••')
      }

      if (data.authorizeUrl) {
        setMessage({
          tone: 'info',
          text: 'Redirecting to Strava for authorization...'
        })
        window.location.href = data.authorizeUrl
        return
      }

      setMessage({
        tone: 'success',
        text: data.message || 'Strava settings saved successfully!'
      })
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'An error occurred. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleUnlink = async () => {
    setError('')
    setMessage(null)
    setIsLoading(true)

    try {
      const data = await deleteStravaSettings()

      setMessage({
        tone: 'success',
        text: data.message || 'Settings removed successfully!'
      })
      setIsConfigured(false)
      setIsConnected(false)
      setClientId('')
      setClientSecret('')
      setWebhookUrl('')
      setDefaultVisibility(DEFAULT_STRAVA_VISIBILITY)
      setShowUnlinkDialog(false)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to remove settings'
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Two sibling cards, as the design draws the page: the credentials, then the
  // archive importer in a card of its own rather than a bordered box tucked under
  // the Save / Unlink buttons. Both live here (not in the page) because the
  // importer's actor handle is resolved from the same settings response the form
  // loads.
  return (
    <>
      <div data-slot="panel" className="rounded-lg border p-6">
        <div className="mb-6 space-y-1">
          <h2 className="text-base font-semibold">Strava settings</h2>
          <p className="text-sm text-muted-foreground">
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
          </p>
        </div>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input
              type="text"
              id="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={isConfigured}
              required
              pattern="[0-9]+"
              title="Client ID must be numeric"
              placeholder="Enter your Strava Client ID"
            />
            <p className="text-[0.8rem] text-muted-foreground">
              Numeric ID from{' '}
              <a
                href="https://www.strava.com/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Strava API settings
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input
              type="password"
              id="clientSecret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={isConfigured}
              required
              placeholder="Enter your Strava Client Secret"
            />
            <p className="text-[0.8rem] text-muted-foreground">
              Secret key from your Strava application
            </p>
          </div>

          <div className="space-y-2">
            {/* Not "Webhook activity visibility": the same stored setting is what
              a retry and the repair scripts post at, so naming one caller
              understates its scope. The archive upload below is the one import
              path that does NOT read it. */}
            <Label>Automatic import visibility</Label>
            <VisibilitySelector
              visibility={defaultVisibility}
              onVisibilityChange={setDefaultVisibility}
            />
            <p className="text-[0.8rem] text-muted-foreground">
              Every activity imported from Strava is posted at this visibility —
              including ones you marked &quot;Only you&quot; or
              &quot;Followers&quot; there. Strava&apos;s own privacy setting for
              an activity is never carried over. Applies to activities the
              webhook delivers and to any retry or repair of one; the archive
              upload below uses its own visibility.
            </p>
            {(defaultVisibility === 'public' ||
              defaultVisibility === 'unlisted') && (
              <Alert
                tone="warning"
                title="Anyone on the fediverse can read these posts."
              >
                An activity you marked &quot;Only you&quot; on Strava will still
                be posted for everyone, with its route map and stats.
              </Alert>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <Alert tone={message.tone} title={message.text} />}

          {isConnected && <Alert tone="success" title="Connected to Strava" />}

          {webhookUrl && (
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                type="text"
                id="webhookUrl"
                value={webhookUrl}
                readOnly
                className="bg-muted"
              />
              <p className="text-[0.8rem] text-muted-foreground">
                Use this URL to configure Strava webhook subscriptions
              </p>
            </div>
          )}

          {isConfigured && !isConnected && (
            <Alert
              tone="warning"
              title="Credentials saved but not connected. Please reconnect."
            />
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                isLoading ||
                (!isConfigured &&
                  (clientId.trim().length === 0 ||
                    clientSecret.trim().length === 0))
              }
            >
              {isLoading
                ? 'Saving...'
                : isConfigured
                  ? 'Save visibility'
                  : 'Save and connect'}
            </Button>

            <Button
              type="button"
              variant="destructive"
              disabled={!isConfigured || isLoading}
              onClick={() => setShowUnlinkDialog(true)}
            >
              Unlink
            </Button>
          </div>
        </form>
      </div>

      <div data-slot="panel" className="rounded-lg border p-6">
        <StravaArchiveImportSection actorHandle={archiveActorHandle} />
      </div>

      <Dialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Strava Integration</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove your Strava integration? This will
              clear your Client ID and Client Secret. You will need to enter
              them again to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUnlinkDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnlink}
              disabled={isLoading}
            >
              {isLoading ? 'Unlinking...' : 'Unlink'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

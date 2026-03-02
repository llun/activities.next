'use client'

import { FC, useEffect, useState } from 'react'

import { VisibilitySelector } from '@/lib/components/post-box/visibility-selector'
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

export const StravaSettingsForm: FC<StravaSettingsFormProps> = ({
  serverActorHandle
}) => {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [isConfigured, setIsConfigured] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false)
  const [archiveActorHandle, setArchiveActorHandle] = useState('')
  const [defaultVisibility, setDefaultVisibility] =
    useState<MastodonVisibility>(DEFAULT_STRAVA_VISIBILITY)

  useEffect(() => {
    const controller = new AbortController()
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/v1/settings/fitness/strava', {
          signal: controller.signal
        })
        const data = await response.json()

        if (data.configured) {
          setIsConfigured(true)
          setIsConnected(data.connected || false)
          setClientId(data.clientId)
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
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setError('Failed to load settings')
      }
    }

    const checkUrlParams = () => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('success') === 'true') {
        setMessage('Successfully connected to Strava!')
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
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/settings/fitness/strava', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          isConfigured
            ? { defaultVisibility }
            : { clientId, clientSecret, defaultVisibility }
        )
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to save settings')
        return
      }

      setIsConfigured(true)
      if (!isConfigured) {
        setClientSecret('••••••••')
      }

      if (data.authorizeUrl) {
        setMessage('Redirecting to Strava for authorization...')
        window.location.href = data.authorizeUrl
        return
      }

      setMessage(data.message || 'Strava settings saved successfully!')
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleUnlink = async () => {
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/settings/fitness/strava', {
        method: 'DELETE'
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to remove settings')
        return
      }

      setMessage('Settings removed successfully!')
      setIsConfigured(false)
      setIsConnected(false)
      setClientId('')
      setClientSecret('')
      setWebhookUrl('')
      setDefaultVisibility(DEFAULT_STRAVA_VISIBILITY)
      setShowUnlinkDialog(false)
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
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
          <Label>Webhook Activity Visibility</Label>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <VisibilitySelector
              visibility={defaultVisibility}
              onVisibilityChange={setDefaultVisibility}
            />
            <span>
              Automatically imported Strava activities will use this visibility.
            </span>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}

        {isConnected && (
          <div className="rounded-md bg-green-50 p-3 dark:bg-green-950">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              ✓ Connected to Strava
            </p>
          </div>
        )}

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
          <div className="rounded-md bg-yellow-50 p-3 dark:bg-yellow-950">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              Credentials saved but not connected. Please reconnect.
            </p>
          </div>
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

        <StravaArchiveImportSection actorHandle={archiveActorHandle} />
      </form>

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

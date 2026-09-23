'use client'

import { useEffect, useState } from 'react'

import {
  type WahooEnvironment,
  type WahooSettingsResponse,
  deleteWahooSettings,
  getWahooSettings,
  saveWahooSettings
} from '@/lib/client'
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
import type { Visibility } from '@/lib/types/mastodon/visibility'

import { WahooFailedImportsSection } from './WahooFailedImportsSection'
import { WahooHistorySection } from './WahooHistorySection'

const fallbackError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const formatConnectionTimestamp = (value?: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return {
    dateTime: date.toISOString(),
    label: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  }
}

export const WahooSettingsForm = () => {
  const [settings, setSettings] = useState<WahooSettingsResponse | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [webhookToken, setWebhookToken] = useState('')
  const [environment, setEnvironment] = useState<WahooEnvironment>('sandbox')
  const [defaultVisibility, setDefaultVisibility] =
    useState<Visibility>('private')
  const [isSaving, setIsSaving] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      try {
        const data = await getWahooSettings(controller.signal)
        if (controller.signal.aborted) return
        setSettings(data)
        setClientId(data.clientId || '')
        setEnvironment(data.environment)
        setDefaultVisibility(data.defaultVisibility)
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(fallbackError(loadError, 'Failed to load Wahoo settings'))
        }
      }
    }

    void load()

    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      setMessage('Connected to Wahoo.')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.has('error')) {
      setError('Wahoo authorization failed. Please try connecting again.')
      window.history.replaceState({}, '', window.location.pathname)
    }

    return () => controller.abort()
  }, [])

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSaving(true)

    try {
      await saveWahooSettings({
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...(webhookToken.trim() ? { webhookToken: webhookToken.trim() } : {}),
        environment,
        defaultVisibility
      })
      setClientSecret('')
      setWebhookToken('')
      setSettings(await getWahooSettings())
      setMessage('Wahoo settings saved.')
    } catch (saveError) {
      setError(fallbackError(saveError, 'Failed to save Wahoo settings'))
    } finally {
      setIsSaving(false)
    }
  }

  const disconnect = async () => {
    setError('')
    setMessage('')
    setIsDisconnecting(true)
    try {
      await deleteWahooSettings()
      const data = await getWahooSettings()
      setSettings(data)
      setClientId('')
      setClientSecret('')
      setWebhookToken('')
      setEnvironment('sandbox')
      setDefaultVisibility('private')
      setShowDisconnectDialog(false)
      setMessage(
        'Wahoo disconnected. Activities already imported here remain available.'
      )
    } catch (disconnectError) {
      setError(fallbackError(disconnectError, 'Failed to disconnect Wahoo'))
    } finally {
      setIsDisconnecting(false)
    }
  }

  const callbackUrl =
    settings?.callbackUrl || '/api/v1/settings/fitness/wahoo/callback'
  const webhookUrl = settings?.webhookUrl || '/api/v1/webhooks/wahoo/'
  const lastWebhookAt = formatConnectionTimestamp(settings?.lastWebhookAt)
  const lastImportAt = formatConnectionTimestamp(settings?.lastImportAt)

  return (
    <div className="space-y-8">
      <form onSubmit={save} className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Application settings</h2>
          <p className="text-sm text-muted-foreground">
            Create a confidential Wahoo application with workouts_read,
            offline_data, and user_read scopes. power_zones_read may remain
            enabled, but is not required for workout imports. Choose the same
            environment here as in the Wahoo developer portal; external sharing
            can remain disabled.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wahoo-client-id">Client ID</Label>
          <Input
            id="wahoo-client-id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            autoComplete="off"
            required
            disabled={isSaving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wahoo-client-secret">Client secret</Label>
          <Input
            id="wahoo-client-secret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            autoComplete="new-password"
            required={!settings?.hasClientSecret}
            placeholder={
              settings?.hasClientSecret ? 'Saved — leave blank to keep' : ''
            }
            disabled={isSaving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wahoo-webhook-token">Webhook token</Label>
          <Input
            id="wahoo-webhook-token"
            type="password"
            value={webhookToken}
            onChange={(event) => setWebhookToken(event.target.value)}
            autoComplete="new-password"
            required={!settings?.hasWebhookToken}
            placeholder={
              settings?.hasWebhookToken ? 'Saved — leave blank to keep' : ''
            }
            disabled={isSaving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wahoo-environment">Environment</Label>
          <select
            id="wahoo-environment"
            value={environment}
            onChange={(event) =>
              setEnvironment(event.target.value as WahooEnvironment)
            }
            disabled={isSaving}
            className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
          {environment === 'sandbox' && (
            <p className="text-xs text-muted-foreground">
              Wahoo sandbox applications cannot later be converted to
              production.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Automatic import visibility</Label>
          <VisibilitySelector
            visibility={defaultVisibility}
            onVisibilityChange={setDefaultVisibility}
          />
          <p className="text-xs text-muted-foreground">
            New and historical Wahoo activities use this visibility when posted.
          </p>
          {(defaultVisibility === 'public' ||
            defaultVisibility === 'unlisted') && (
            <p
              role="alert"
              className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
            >
              Anyone on the fediverse can read imported workouts, including
              route maps and stats.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <h3 className="font-medium">Wahoo application URLs</h3>
          <div className="space-y-1">
            <Label htmlFor="wahoo-callback-url">Callback URL</Label>
            <Input
              id="wahoo-callback-url"
              readOnly
              value={callbackUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wahoo-webhook-url">Webhook URL</Label>
            <Input
              id="wahoo-webhook-url"
              readOnly
              value={webhookUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Copy these URLs into the matching Wahoo application fields. Webhooks
            require a publicly reachable HTTPS URL; localhost cannot receive
            Wahoo events.
          </p>
        </div>

        {settings?.connected ? (
          <p
            role="status"
            className="text-sm text-green-700 dark:text-green-400"
          >
            Connected to Wahoo
            {settings.providerUserId
              ? ` (user ${settings.providerUserId})`
              : ''}
            .
          </p>
        ) : settings?.configured ? (
          <p role="status" className="text-sm text-muted-foreground">
            Application saved. Connect to authorize your Wahoo account.
          </p>
        ) : null}
        {settings && (
          <div className="space-y-2 rounded-md border p-4 text-sm">
            <h3 className="font-medium">Connection activity</h3>
            <p>
              Last webhook:{' '}
              {lastWebhookAt ? (
                <time dateTime={lastWebhookAt.dateTime}>
                  {lastWebhookAt.label}
                </time>
              ) : (
                <span className="text-muted-foreground">
                  No webhook received yet
                </span>
              )}
            </p>
            <p>
              Last successful import:{' '}
              {lastImportAt ? (
                <time dateTime={lastImportAt.dateTime}>
                  {lastImportAt.label}
                </time>
              ) : (
                <span className="text-muted-foreground">
                  No successful import yet
                </span>
              )}
            </p>
          </div>
        )}
        {settings?.lastError && (
          <p role="alert" className="text-sm text-destructive">
            Last import error: {settings.lastError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="text-sm text-green-700 dark:text-green-400"
          >
            {message}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSaving || !settings}>
            {isSaving ? 'Saving…' : 'Save settings'}
          </Button>
          {settings?.configured && !isSaving && (
            <Button asChild variant="outline">
              <a href="/api/v1/settings/fitness/wahoo/authorize">
                {settings.connected ? 'Reconnect' : 'Connect'}
              </a>
            </Button>
          )}
          {settings?.configured && (
            <Button
              type="button"
              variant="destructive"
              disabled={isSaving}
              onClick={() => setShowDisconnectDialog(true)}
            >
              Disconnect
            </Button>
          )}
        </div>
      </form>

      <WahooHistorySection
        connected={Boolean(settings?.connected)}
        automaticImportAvailable={Boolean(settings?.automaticImportAvailable)}
      />
      <WahooFailedImportsSection
        connected={Boolean(settings?.connected)}
        automaticImportAvailable={Boolean(settings?.automaticImportAvailable)}
      />

      <Dialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Wahoo?</DialogTitle>
            <DialogDescription>
              This removes the connection and saved application credentials.
              Activities already imported here remain available.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDisconnectDialog(false)}
              disabled={isDisconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void disconnect()}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

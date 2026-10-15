'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ReadOnlyUrlRow } from '@/app/(timeline)/fitness/connections/ReadOnlyUrlRow'
import {
  type WahooEnvironment,
  type WahooSettingsResponse,
  deleteWahooSettings,
  getWahooSettings,
  saveWahooSettings
} from '@/lib/client'
import { VisibilitySelector } from '@/lib/components/post-box/visibility-selector'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
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
import { Select } from '@/lib/components/ui/select'
import type { Visibility } from '@/lib/types/mastodon/visibility'
import { cn } from '@/lib/utils'

import { WahooFailedImportsSection } from './WahooFailedImportsSection'
import { WahooHistorySection } from './WahooHistorySection'

const fallbackError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const callbackErrorMessages: Record<string, string> = {
  wahoo_account_already_connected:
    'This Wahoo account and webhook token are already connected to another profile.',
  credentials_changed:
    'Wahoo settings changed during authorization. Please connect again.'
}

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
      setError(
        callbackErrorMessages[params.get('error') ?? ''] ??
          'Wahoo authorization failed. Please try connecting again.'
      )
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
    <div className="space-y-6">
      <Section
        title="Application settings"
        description="Create a confidential Wahoo application with workouts_read, offline_data, and user_read scopes. power_zones_read may remain enabled, but is not required for workout imports. Choose the same environment here as in the Wahoo developer portal; external sharing can remain disabled."
      >
        <form onSubmit={save}>
          <Frame
            form
            footer={
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                {error ? (
                  <p
                    role="alert"
                    className="text-destructive-text min-w-0 text-sm break-words"
                  >
                    {error}
                  </p>
                ) : (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-muted-foreground min-w-0 text-sm break-words"
                  >
                    {message}
                  </p>
                )}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
                  {settings?.configured && !isSaving && (
                    <Button asChild variant="outline">
                      <a href="/api/v1/settings/fitness/wahoo/authorize">
                        {settings.connected ? 'Reconnect' : 'Connect'}
                      </a>
                    </Button>
                  )}
                  <Button type="submit" disabled={isSaving || !settings}>
                    {isSaving ? (
                      <Loader2
                        data-slot="spinner"
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : null}
                    Save settings
                  </Button>
                </div>
              </div>
            }
          >
            <FormRow label="Client ID" htmlFor="wahoo-client-id">
              <Input
                id="wahoo-client-id"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
                required
                disabled={isSaving}
              />
            </FormRow>

            <FormRow label="Client secret" htmlFor="wahoo-client-secret">
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
            </FormRow>

            <FormRow label="Webhook token" htmlFor="wahoo-webhook-token">
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
            </FormRow>

            <FormRow
              label="Environment"
              htmlFor="wahoo-environment"
              hint={
                environment === 'sandbox'
                  ? 'Wahoo sandbox applications cannot later be converted to production.'
                  : undefined
              }
            >
              {({ describedBy }) => (
                <Select
                  id="wahoo-environment"
                  value={environment}
                  onChange={(event) =>
                    setEnvironment(event.target.value as WahooEnvironment)
                  }
                  disabled={isSaving}
                  aria-describedby={describedBy}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </Select>
              )}
            </FormRow>

            <FormRow
              label="Automatic import visibility"
              hint="New and historical Wahoo activities use this visibility when posted."
            >
              {({ describedBy, labelledBy }) => (
                <div
                  role="group"
                  aria-labelledby={labelledBy}
                  aria-describedby={describedBy}
                >
                  <VisibilitySelector
                    visibility={defaultVisibility}
                    onVisibilityChange={setDefaultVisibility}
                  />
                </div>
              )}
            </FormRow>

            {(defaultVisibility === 'public' ||
              defaultVisibility === 'unlisted' ||
              settings?.connected ||
              settings?.configured ||
              settings?.lastError) && (
              <div className="space-y-3 px-4 py-2.5">
                {(defaultVisibility === 'public' ||
                  defaultVisibility === 'unlisted') && (
                  <Alert
                    tone="warning"
                    title="Anyone on the fediverse can read imported workouts, including route maps and stats."
                  />
                )}
                {settings?.connected ? (
                  <Alert
                    tone="success"
                    title={`Connected to Wahoo${
                      settings.providerUserId
                        ? ` (user ${settings.providerUserId})`
                        : ''
                    }.`}
                  />
                ) : settings?.configured ? (
                  <p role="status" className="text-muted-foreground text-sm">
                    Application saved. Connect to authorize your Wahoo account.
                  </p>
                ) : null}
                {settings?.lastError && (
                  // Standing state read from the saved settings at load, not news.
                  <Alert
                    live={false}
                    title={`Wahoo error: ${settings.lastError}`}
                  />
                )}
              </div>
            )}
          </Frame>
        </form>
      </Section>

      <Section title="Wahoo application URLs">
        <Frame
          form
          footer={
            <p className="text-muted-foreground text-xs">
              Copy these URLs into the matching Wahoo application fields.
              Webhooks require a publicly reachable HTTPS URL; localhost cannot
              receive Wahoo events.
            </p>
          }
        >
          <ReadOnlyUrlRow
            id="wahoo-callback-url"
            label="Callback URL"
            value={callbackUrl}
          />
          <ReadOnlyUrlRow
            id="wahoo-webhook-url"
            label="Webhook URL"
            value={webhookUrl}
          />
        </Frame>
      </Section>

      {settings && (
        <Section title="Connection activity">
          <Frame form>
            <FormRow label="Last webhook">
              <p className="text-sm">
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
            </FormRow>
            <FormRow label="Last successful import">
              <p className="text-sm">
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
            </FormRow>
          </Frame>
        </Section>
      )}

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

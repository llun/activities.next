'use client'

import { FC, useEffect, useState } from 'react'

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

export const StravaSettingsForm: FC = () => {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [isConfigured, setIsConfigured] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false)

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
          setWebhookVerifyToken(data.webhookVerifyToken || '')
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
            : 'Failed to connect to Strava'
        )
        window.history.replaceState(
          {},
          '',
          window.location.pathname + window.location.hash
        )
      }
    }

    fetchSettings()
    checkUrlParams()

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
        body: JSON.stringify({ clientId, clientSecret })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to save settings')
        return
      }

      setMessage('Redirecting to Strava for authorization...')
      setIsConfigured(true)
      setClientSecret('••••••••')

      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl
      }
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
      setWebhookVerifyToken('')
      setShowUnlinkDialog(false)
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSave} className="space-y-4">
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

        {webhookVerifyToken && (
          <div className="space-y-2">
            <Label htmlFor="webhookVerifyToken">Webhook Verify Token</Label>
            <Input
              type="text"
              id="webhookVerifyToken"
              value={webhookVerifyToken}
              readOnly
              className="bg-muted"
            />
            <p className="text-[0.8rem] text-muted-foreground">
              Use this token when creating the webhook subscription on Strava
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
          <Button type="submit" disabled={isLoading || isConfigured}>
            {isLoading ? 'Saving...' : 'Save'}
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

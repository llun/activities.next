'use client'

import { FC, useCallback, useEffect, useState } from 'react'

import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'

interface NotificationTypeConfig {
  key: string
  label: string
  description: string
}

interface Props {
  actorId: string
  pushNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
    activity_import?: boolean
  }
  notificationTypes: NotificationTypeConfig[]
}

type PushState =
  | 'loading'
  | 'unsupported'
  | 'not_configured'
  | 'permission_denied'
  | 'disabled'
  | 'enabled'
  | 'error'

export const PushNotificationSettings: FC<Props> = ({
  actorId,
  pushNotifications,
  notificationTypes
}) => {
  const [pushState, setPushState] = useState<PushState>('loading')
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null
  )
  const [perTypeSettings, setPerTypeSettings] = useState<
    Record<string, boolean>
  >(() => {
    const settings: Record<string, boolean> = {}
    for (const nt of notificationTypes) {
      const key = nt.key as keyof typeof pushNotifications
      settings[nt.key] = pushNotifications?.[key] !== false
    }
    return settings
  })
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported')
      return
    }

    fetch('/api/v1/push/vapid-key')
      .then(async (res) => {
        if (!res.ok) {
          setPushState('not_configured')
          return
        }
        const data = await res.json()
        setVapidPublicKey(data.vapidPublicKey)

        if (Notification.permission === 'denied') {
          setPushState('permission_denied')
          return
        }

        const registration = await navigator.serviceWorker.getRegistration('/')
        if (!registration) {
          setPushState('disabled')
          return
        }

        const existing = await registration.pushManager.getSubscription()
        if (existing) {
          setSubscription(existing)
          setPushState('enabled')
        } else {
          setPushState('disabled')
        }
      })
      .catch(() => setPushState('error'))
  }, [])

  const handleEnable = useCallback(async () => {
    if (!vapidPublicKey) return

    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState('permission_denied')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          vapidPublicKey
        ) as unknown as ArrayBuffer
      })

      const subJson = sub.toJSON()
      const res = await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys
        })
      })

      if (!res.ok) {
        await sub.unsubscribe()
        setPushState('error')
        return
      }

      setSubscription(sub)
      setPushState('enabled')
    } catch {
      setPushState('error')
    }
  }, [vapidPublicKey])

  const handleDisable = useCallback(async () => {
    if (!subscription) return

    try {
      await fetch('/api/v1/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      })

      await subscription.unsubscribe()

      setSubscription(null)
      setPushState('disabled')
    } catch {
      setPushState('error')
    }
  }, [subscription])

  const handleTypeToggle = useCallback(
    async (key: string, enabled: boolean) => {
      const updated = { ...perTypeSettings, [key]: enabled }
      setPerTypeSettings(updated)
      setSaving(true)
      setStatusMessage(null)

      try {
        const res = await fetch('/api/v1/accounts/push-notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId, ...updated })
        })
        if (res.ok) {
          setStatusMessage('Saved')
        } else {
          setStatusMessage('Failed to save')
        }
      } catch {
        setStatusMessage('Failed to save')
      } finally {
        setSaving(false)
      }
    },
    [actorId, perTypeSettings]
  )

  return (
    <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Push Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Receive browser push notifications for activity on your account.
        </p>
      </div>

      {pushState === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {pushState === 'unsupported' && (
        <p className="text-sm text-muted-foreground">
          Push notifications are not supported by your browser.
        </p>
      )}

      {pushState === 'not_configured' && (
        <p className="text-sm text-muted-foreground">
          Push notifications are not configured on this server. Set{' '}
          <code className="font-mono text-xs">
            ACTIVITIES_PUSH_VAPID_PUBLIC_KEY
          </code>
          ,{' '}
          <code className="font-mono text-xs">
            ACTIVITIES_PUSH_VAPID_PRIVATE_KEY
          </code>
          , and{' '}
          <code className="font-mono text-xs">ACTIVITIES_PUSH_VAPID_EMAIL</code>{' '}
          to enable.
        </p>
      )}

      {pushState === 'permission_denied' && (
        <p className="text-sm text-muted-foreground">
          Notification permission was denied. Please enable it in your
          browser&apos;s site settings and reload the page.
        </p>
      )}

      {pushState === 'error' && (
        <p className="text-sm text-destructive">
          An error occurred. Please reload the page and try again.
        </p>
      )}

      {(pushState === 'disabled' || pushState === 'enabled') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="cursor-pointer">
                Enable Push Notifications
              </Label>
              <p className="text-[0.8rem] text-muted-foreground">
                {pushState === 'enabled'
                  ? 'Push notifications are active in this browser.'
                  : 'Enable to receive notifications even when the tab is closed.'}
              </p>
            </div>
            <Switch
              checked={pushState === 'enabled'}
              onCheckedChange={(checked) => {
                if (checked) {
                  handleEnable()
                } else {
                  handleDisable()
                }
              }}
            />
          </div>

          {pushState === 'enabled' && (
            <>
              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-3">Notify me about:</p>
                <div className="space-y-4">
                  {notificationTypes.map((nt) => (
                    <div
                      key={nt.key}
                      className="flex items-center justify-between gap-4"
                    >
                      <div className="space-y-0.5">
                        <Label
                          htmlFor={`push-${nt.key}`}
                          className="cursor-pointer"
                        >
                          {nt.label}
                        </Label>
                        <p className="text-[0.8rem] text-muted-foreground">
                          {nt.description}
                        </p>
                      </div>
                      <Switch
                        id={`push-${nt.key}`}
                        checked={perTypeSettings[nt.key] !== false}
                        disabled={saving}
                        onCheckedChange={(checked) =>
                          handleTypeToggle(nt.key, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              {statusMessage && (
                <p className="text-sm text-muted-foreground">{statusMessage}</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)))
}

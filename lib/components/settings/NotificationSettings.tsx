'use client'

import Link from 'next/link'
import { FC, useCallback, useEffect, useState } from 'react'

import {
  getVapidKey,
  subscribePushNotifications,
  unsubscribePushNotifications,
  updateEmailNotifications,
  updatePushNotifications
} from '@/lib/client'
import { ActorSelector } from '@/lib/components/settings/ActorSelector'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import { urlBase64ToUint8Array } from '@/lib/utils/urlBase64ToUint8Array'

interface NotificationTypeConfig {
  key: string
  label: string
  description: string
}

interface Props {
  actorId: string
  accountEmail: string
  actors: Array<{
    id: string
    username: string
    domain: string
    name?: string | null
  }>
  emailNotifications?: Record<string, boolean | undefined>
  pushNotifications?: Record<string, boolean | undefined>
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

export const NotificationSettings: FC<Props> = ({
  actorId,
  accountEmail,
  actors,
  emailNotifications,
  pushNotifications,
  notificationTypes
}) => {
  // --- Email state ---
  const [emailSettings, setEmailSettings] = useState<Record<string, boolean>>(
    () => {
      const settings: Record<string, boolean> = {}
      for (const nt of notificationTypes) {
        settings[nt.key] = emailNotifications?.[nt.key] !== false
      }
      return settings
    }
  )
  const [emailMasterEnabled, setEmailMasterEnabled] = useState(() =>
    notificationTypes.some((nt) => emailNotifications?.[nt.key] !== false)
  )
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailStatusMessage, setEmailStatusMessage] = useState<string | null>(
    null
  )

  // --- Push state ---
  const [pushState, setPushState] = useState<PushState>('loading')
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null
  )
  const [pushSettings, setPushSettings] = useState<Record<string, boolean>>(
    () => {
      const settings: Record<string, boolean> = {}
      for (const nt of notificationTypes) {
        settings[nt.key] = pushNotifications?.[nt.key] !== false
      }
      return settings
    }
  )
  const [pushSaving, setPushSaving] = useState(false)
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(
    null
  )

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported')
      return
    }

    getVapidKey()
      .then(async (vapidKey) => {
        if (!vapidKey) {
          setPushState('not_configured')
          return
        }
        setVapidPublicKey(vapidKey)

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

  const saveEmailSettings = useCallback(
    async (settings: Record<string, boolean>) => {
      setEmailSaving(true)
      setEmailStatusMessage(null)
      try {
        const ok = await updateEmailNotifications(actorId, settings)
        setEmailStatusMessage(ok ? 'Saved' : 'Failed to save')
      } catch {
        setEmailStatusMessage('Failed to save')
      } finally {
        setEmailSaving(false)
      }
    },
    [actorId]
  )

  const handleEmailMasterToggle = useCallback(
    async (enabled: boolean) => {
      setEmailMasterEnabled(enabled)
      if (!enabled) {
        // Turn off all email notification types
        const allOff: Record<string, boolean> = {}
        for (const nt of notificationTypes) {
          allOff[nt.key] = false
        }
        await saveEmailSettings(allOff)
      } else {
        // Restore per-type settings
        await saveEmailSettings(emailSettings)
      }
    },
    [notificationTypes, emailSettings, saveEmailSettings]
  )

  const handleEmailTypeToggle = useCallback(
    async (key: string, enabled: boolean) => {
      const updated = { ...emailSettings, [key]: enabled }
      setEmailSettings(updated)
      await saveEmailSettings(updated)
    },
    [emailSettings, saveEmailSettings]
  )

  const handlePushEnable = useCallback(async () => {
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
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      })

      const subJson = sub.toJSON()
      const ok = await subscribePushNotifications(
        subJson.endpoint!,
        subJson.keys as { p256dh: string; auth: string }
      )

      if (!ok) {
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

  const handlePushDisable = useCallback(async () => {
    if (!subscription) return

    try {
      const ok = await unsubscribePushNotifications(subscription.endpoint)

      if (!ok) {
        setPushState('error')
        return
      }

      await subscription.unsubscribe()
      setSubscription(null)
      setPushState('disabled')
    } catch {
      setPushState('error')
    }
  }, [subscription])

  const handlePushTypeToggle = useCallback(
    async (key: string, enabled: boolean) => {
      const updated = { ...pushSettings, [key]: enabled }
      setPushSettings(updated)
      setPushSaving(true)
      setPushStatusMessage(null)

      try {
        const ok = await updatePushNotifications(actorId, updated)
        setPushStatusMessage(ok ? 'Saved' : 'Failed to save')
      } catch {
        setPushStatusMessage('Failed to save')
      } finally {
        setPushSaving(false)
      }
    },
    [actorId, pushSettings]
  )

  const pushEnabled = pushState === 'enabled'
  const pushConfigured = pushState === 'enabled' || pushState === 'disabled'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification Settings</h1>
        <p className="text-sm text-muted-foreground">
          Control which notifications are sent and how. Email notifications go
          to <span className="font-medium">{accountEmail}</span>.{' '}
          <Link
            href="/settings"
            className="text-blue-600 hover:text-blue-800 underline"
          >
            Change email address
          </Link>
        </p>
      </div>

      <ActorSelector actors={actors} selectedActorId={actorId} />

      {/* Channel master toggles */}
      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Channels</h2>
          <p className="text-sm text-muted-foreground">
            Enable or disable notification delivery channels.
          </p>
        </div>

        <div className="space-y-4">
          {/* Email master toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="cursor-pointer">Email ({accountEmail})</Label>
              <p className="text-[0.8rem] text-muted-foreground">
                {emailMasterEnabled
                  ? 'Email notifications are enabled.'
                  : 'Email notifications are disabled.'}
              </p>
            </div>
            <Switch
              checked={emailMasterEnabled}
              disabled={emailSaving}
              onCheckedChange={handleEmailMasterToggle}
            />
          </div>

          {/* Push master toggle */}
          {pushState === 'loading' && (
            <p className="text-sm text-muted-foreground">
              Loading push notification status…
            </p>
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
              <code className="font-mono text-xs">
                ACTIVITIES_PUSH_VAPID_EMAIL
              </code>{' '}
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
              An error occurred with push notifications. Please reload the page
              and try again.
            </p>
          )}
          {pushConfigured && (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="cursor-pointer">Push Notifications</Label>
                <p className="text-[0.8rem] text-muted-foreground">
                  {pushEnabled
                    ? 'Push notifications are active in this browser.'
                    : 'Enable to receive notifications even when the tab is closed.'}
                </p>
              </div>
              <Switch
                checked={pushEnabled}
                onCheckedChange={(checked) => {
                  if (checked) {
                    handlePushEnable()
                  } else {
                    handlePushDisable()
                  }
                }}
              />
            </div>
          )}
        </div>
      </section>

      {/* Event preferences table */}
      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Event Preferences</h2>
          <p className="text-sm text-muted-foreground">
            Choose which events trigger notifications for each channel.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium">Event</th>
                <th className="text-center py-2 px-4 font-medium min-w-[80px]">
                  Email
                </th>
                <th className="text-center py-2 px-4 font-medium min-w-[80px]">
                  Push
                </th>
              </tr>
            </thead>
            <tbody>
              {notificationTypes.map((nt) => (
                <tr key={nt.key} className="border-b last:border-0">
                  <td className="py-3 pr-4">
                    <div>
                      <span className="font-medium">{nt.label}</span>
                      <p className="text-[0.8rem] text-muted-foreground">
                        {nt.description}
                      </p>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Switch
                      id={`email-${nt.key}`}
                      aria-label={`${nt.label} email notifications`}
                      checked={
                        emailMasterEnabled && emailSettings[nt.key] !== false
                      }
                      disabled={!emailMasterEnabled || emailSaving}
                      onCheckedChange={(checked) =>
                        handleEmailTypeToggle(nt.key, checked)
                      }
                    />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Switch
                      id={`push-${nt.key}`}
                      aria-label={`${nt.label} push notifications`}
                      checked={pushEnabled && pushSettings[nt.key] !== false}
                      disabled={!pushEnabled || pushSaving}
                      onCheckedChange={(checked) =>
                        handlePushTypeToggle(nt.key, checked)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(emailStatusMessage || pushStatusMessage) && (
          <p className="text-sm text-muted-foreground">
            {emailStatusMessage || pushStatusMessage}
          </p>
        )}
      </section>
    </div>
  )
}

'use client'

import { Bell, Mail } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useEffect, useState } from 'react'

import {
  getVapidKey,
  subscribePushNotifications,
  unsubscribePushNotifications,
  updateEmailNotifications,
  updatePushNotifications
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { ActorSelector } from '@/lib/components/settings/ActorSelector'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SavedIndicator } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { Switch } from '@/lib/components/ui/switch'
import { cn } from '@/lib/utils'
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
  const statusMessage = emailStatusMessage || pushStatusMessage
  const saveFailed = statusMessage !== null && statusMessage !== 'Saved'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification settings"
        description={
          <>
            Control which notifications are sent and how. Email notifications go
            to <span className="font-medium">{accountEmail}</span>.{' '}
            <Link href="/settings" className="text-primary-text underline">
              Change email address
            </Link>
          </>
        }
      />

      <ActorSelector actors={actors} selectedActorId={actorId} />

      {/* Channel master toggles */}
      <Section
        icon={Bell}
        title="Channels"
        description="Enable or disable notification delivery channels."
      >
        <Frame divided className="overflow-hidden">
          {/* Email master toggle */}
          <FormRow
            label={`Email (${accountEmail})`}
            htmlFor="email-master"
            hint={
              emailMasterEnabled
                ? 'Email notifications are enabled.'
                : 'Email notifications are disabled.'
            }
            inline
          >
            {({ describedBy }) => (
              <Switch
                id="email-master"
                aria-describedby={describedBy}
                checked={emailMasterEnabled}
                disabled={emailSaving}
                onCheckedChange={handleEmailMasterToggle}
              />
            )}
          </FormRow>

          {/* Push master toggle */}
          {pushState === 'loading' && (
            <div className="px-4 py-4">
              <SkeletonRows
                rows={1}
                rowClassName="h-10"
                label="Loading push notification status"
              />
            </div>
          )}
          {pushState === 'unsupported' && (
            <Alert
              tone="info"
              flush
              title="Push notifications are not supported by your browser."
            />
          )}
          {pushState === 'not_configured' && (
            <Alert
              tone="info"
              flush
              title="Push notifications are not configured on this server."
            />
          )}
          {pushState === 'permission_denied' && (
            <Alert
              tone="warning"
              flush
              title="Notification permission was denied."
            >
              Please enable it in your browser&apos;s site settings and reload
              the page.
            </Alert>
          )}
          {pushState === 'error' && (
            <Alert flush title="An error occurred with push notifications.">
              Please reload the page and try again.
            </Alert>
          )}
          {pushConfigured && (
            <FormRow
              label="Push notifications"
              htmlFor="push-master"
              hint={
                pushEnabled
                  ? 'Push notifications are active in this browser.'
                  : 'Enable to receive notifications even when the tab is closed.'
              }
              inline
            >
              {({ describedBy }) => (
                <Switch
                  id="push-master"
                  aria-describedby={describedBy}
                  checked={pushEnabled}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handlePushEnable()
                    } else {
                      handlePushDisable()
                    }
                  }}
                />
              )}
            </FormRow>
          )}
        </Frame>
      </Section>

      {/* Event preferences table */}
      <Section
        icon={Mail}
        title="Event preferences"
        description="Choose which events trigger notifications for each channel."
        actions={<SavedIndicator saved={statusMessage === 'Saved'} />}
      >
        {saveFailed ? (
          <Alert title="Failed to save">
            Your last change may not have been saved. Try the switch again.
          </Alert>
        ) : null}
        <TableFrame aria-label="Event preferences">
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
              <th className={cn(TABLE_CELL_CLASS, 'px-4 font-medium')}>
                Event
              </th>
              <th
                className={cn(
                  TABLE_CELL_CLASS,
                  'min-w-[80px] text-center font-medium'
                )}
              >
                Email
              </th>
              <th
                className={cn(
                  TABLE_CELL_CLASS,
                  'min-w-[80px] text-center font-medium'
                )}
              >
                Push
              </th>
            </tr>
          </thead>
          <tbody>
            {notificationTypes.map((nt) => (
              <tr key={nt.key} className="border-b last:border-0">
                <td className={cn(TABLE_CELL_CLASS, 'px-4 py-3')}>
                  <div>
                    <span className="font-medium">{nt.label}</span>
                    <p className="text-muted-foreground text-xs">
                      {nt.description}
                    </p>
                  </div>
                </td>
                <td className={cn(TABLE_CELL_CLASS, 'text-center')}>
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
                <td className={cn(TABLE_CELL_CLASS, 'text-center')}>
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
        </TableFrame>
      </Section>
    </div>
  )
}

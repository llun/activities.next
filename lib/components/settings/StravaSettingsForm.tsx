'use client'

import { useState } from 'react'

import { Button } from '@/lib/components/ui/button'

interface StravaSettingsFormProps {
  children: React.ReactNode
  initialClientId?: string
  initialClientSecret?: string
}

export function StravaSettingsForm({
  children,
  initialClientId = '',
  initialClientSecret = ''
}: StravaSettingsFormProps) {
  const [clientId, setClientId] = useState(initialClientId)
  const [clientSecret, setClientSecret] = useState(initialClientSecret)

  const isValid = clientId.trim().length > 0 && clientSecret.trim().length > 0

  return (
    <form action="/api/v1/accounts/strava-settings" method="post">
      <div
        onChange={(e) => {
          const target = e.target as HTMLInputElement
          if (target.name === 'clientId') {
            setClientId(target.value)
          } else if (target.name === 'clientSecret') {
            setClientSecret(target.value)
          }
        }}
      >
        {children}
      </div>
      <div className="flex justify-end mt-6">
        <Button type="submit" disabled={!isValid}>
          Save Settings
        </Button>
      </div>
    </form>
  )
}

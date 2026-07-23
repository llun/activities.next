'use client'

import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import type { ServerSettingLocks } from './InstanceSettingsForm'
import { NumberField } from './NumberField'
import { SaveBar } from './SaveBar'
import { SettingsField } from './SettingsField'
import { SettingsSection } from './SettingsSection'
import { useServerSettingsForm } from './useServerSettingsForm'

const BYTES_PER_MB = 1024 * 1024

interface NetworkSettingsFormProps {
  settings: ResolvedServerSettings
  locks: ServerSettingLocks
}

const NETWORK_KEYS = [
  'network.requestTimeoutMs',
  'network.requestRetries',
  'network.maxResponseSizeBytes'
]

export const NetworkSettingsForm: FC<NetworkSettingsFormProps> = ({
  settings,
  locks
}) => {
  const { values, setValue, isDirty, statusFor, saveSection } =
    useServerSettingsForm({
      'network.requestTimeoutMs': settings.network.requestTimeoutMs,
      'network.requestRetries': settings.network.requestRetries,
      'network.maxResponseSizeBytes': settings.network.maxResponseSizeBytes
    })

  const lock = (key: string) => locks[key] ?? { locked: false }
  const status = statusFor('network')
  const responseBytes = values['network.maxResponseSizeBytes'] as number

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network"
        description="How this server talks to the rest of the network. Integrations like translation and maps are configured in the environment."
      />

      <SettingsSection
        title="Advanced — outbound requests"
        description="How this server talks to other servers. Defaults are fine for almost everyone."
        footer={
          <SaveBar
            dirty={isDirty(NETWORK_KEYS)}
            saving={status.saving}
            saved={status.saved}
            error={status.error}
            onSave={() => saveSection('network', NETWORK_KEYS)}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SettingsField
            label="Timeout"
            htmlFor="network-timeout"
            locked={lock('network.requestTimeoutMs').locked}
            envVar={lock('network.requestTimeoutMs').envVar}
          >
            <NumberField
              id="network-timeout"
              value={values['network.requestTimeoutMs'] as number}
              min={1}
              suffix="ms"
              disabled={lock('network.requestTimeoutMs').locked}
              onChange={(next) => setValue('network.requestTimeoutMs', next)}
            />
          </SettingsField>

          <SettingsField
            label="Retries"
            htmlFor="network-retries"
            locked={lock('network.requestRetries').locked}
            envVar={lock('network.requestRetries').envVar}
          >
            <NumberField
              id="network-retries"
              value={values['network.requestRetries'] as number}
              min={0}
              max={20}
              suffix="attempts"
              disabled={lock('network.requestRetries').locked}
              onChange={(next) => setValue('network.requestRetries', next)}
            />
          </SettingsField>

          <SettingsField
            label="Response size cap"
            htmlFor="network-response-cap"
            locked={lock('network.maxResponseSizeBytes').locked}
            envVar={lock('network.maxResponseSizeBytes').envVar}
          >
            <NumberField
              id="network-response-cap"
              value={Math.round(responseBytes / BYTES_PER_MB)}
              min={1}
              suffix="MB"
              disabled={lock('network.maxResponseSizeBytes').locked}
              onChange={(next) =>
                setValue(
                  'network.maxResponseSizeBytes',
                  Math.round(next * BYTES_PER_MB)
                )
              }
            />
          </SettingsField>
        </div>
      </SettingsSection>
    </div>
  )
}

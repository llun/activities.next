'use client'

import { FC } from 'react'

import { Select } from '@/lib/components/ui/select'
import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import type { ServerSettingLocks } from './InstanceSettingsForm'
import { LinesTextarea } from './LinesTextarea'
import { SaveBar } from './SaveBar'
import { SettingsField } from './SettingsField'
import { SettingsSection } from './SettingsSection'
import { useServerSettingsForm } from './useServerSettingsForm'

interface FederationPolicyFormProps {
  settings: ResolvedServerSettings
  locks: ServerSettingLocks
  // Trusted media domains stay env-configured: they feed the CSP built in the
  // Edge runtime, which cannot read the database. Shown read-only.
  mediaDomains: string[]
}

const FEDERATION_KEYS = ['federation.mode', 'federation.allowActorDomains']

export const FederationPolicyForm: FC<FederationPolicyFormProps> = ({
  settings,
  locks,
  mediaDomains
}) => {
  const { values, setValue, isDirty, statusFor, saveSection } =
    useServerSettingsForm({
      'federation.mode': settings.federation.mode,
      'federation.allowActorDomains': settings.federation.allowActorDomains
    })

  const lock = (key: string) => locks[key] ?? { locked: false }
  const status = statusFor('federation')
  const mode = values['federation.mode'] as 'open' | 'allowlist'

  return (
    <SettingsSection
      title="Federation policy"
      description="Who this instance federates with by default. Per-domain blocks below still apply."
      footer={
        <SaveBar
          dirty={isDirty(FEDERATION_KEYS)}
          saving={status.saving}
          saved={status.saved}
          error={status.error}
          onSave={() => saveSection('federation', FEDERATION_KEYS)}
        />
      }
    >
      <SettingsField
        label="Mode"
        htmlFor="federation-mode"
        locked={lock('federation.mode').locked}
        envVar={lock('federation.mode').envVar}
      >
        <Select
          id="federation-mode"
          value={mode}
          disabled={lock('federation.mode').locked}
          onChange={(event) => setValue('federation.mode', event.target.value)}
        >
          <option value="open">Open — federate with any server</option>
          <option value="allowlist">
            Allowlist — only servers listed below
          </option>
        </Select>
      </SettingsField>

      {mode === 'allowlist' && (
        <SettingsField
          label="Allowed servers"
          htmlFor="federation-actor-domains"
          help="One domain per line. Actors elsewhere are ignored."
          locked={lock('federation.allowActorDomains').locked}
          envVar={lock('federation.allowActorDomains').envVar}
        >
          <LinesTextarea
            id="federation-actor-domains"
            value={values['federation.allowActorDomains'] as string[]}
            disabled={lock('federation.allowActorDomains').locked}
            onChange={(next) => setValue('federation.allowActorDomains', next)}
          />
        </SettingsField>
      )}

      <SettingsField
        label="Trusted media domains"
        htmlFor="federation-media-domains"
        locked
        help="Configured in the environment; the ACTIVITIES_ALLOW_MEDIA_DOMAINS variable feeds the Content-Security-Policy and cannot be managed here."
      >
        <LinesTextarea
          id="federation-media-domains"
          value={mediaDomains}
          disabled
          rows={2}
          onChange={() => {}}
        />
      </SettingsField>
    </SettingsSection>
  )
}

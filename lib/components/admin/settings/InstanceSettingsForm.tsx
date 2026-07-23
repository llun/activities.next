'use client'

import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Input } from '@/lib/components/ui/input'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import { LanguagesPicker } from './LanguagesPicker'
import { LinesTextarea } from './LinesTextarea'
import { SaveBar } from './SaveBar'
import { ControlRow, SettingsField } from './SettingsField'
import { SettingsSection } from './SettingsSection'
import { useServerSettingsForm } from './useServerSettingsForm'

export type ServerSettingLocks = Record<
  string,
  { locked: boolean; envVar?: string }
>

interface InstanceSettingsFormProps {
  settings: ResolvedServerSettings
  locks: ServerSettingLocks
}

const DETAILS_KEYS = [
  'instance.name',
  'instance.description',
  'instance.contactEmail',
  'instance.languages'
]
const REGISTRATION_KEYS = ['registrations.open', 'registrations.allowEmails']

export const InstanceSettingsForm: FC<InstanceSettingsFormProps> = ({
  settings,
  locks
}) => {
  const { values, setValue, isDirty, statusFor, saveSection } =
    useServerSettingsForm({
      'instance.name': settings.instance.name,
      'instance.description': settings.instance.description,
      'instance.contactEmail': settings.instance.contactEmail,
      'instance.languages': settings.instance.languages,
      'registrations.open': settings.registrations.open,
      'registrations.allowEmails': settings.registrations.allowEmails
    })

  const lock = (key: string) => locks[key] ?? { locked: false }
  const detailsStatus = statusFor('details')
  const registrationStatus = statusFor('registrations')
  const registrationOpen = values['registrations.open'] as boolean

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instance"
        description="Who this instance is and who may join. Values pinned by an environment variable are locked until the variable is removed."
      />

      <SettingsSection
        title="Instance details"
        description="Public information shown on the about page and in the API."
        footer={
          <SaveBar
            dirty={isDirty(DETAILS_KEYS)}
            saving={detailsStatus.saving}
            saved={detailsStatus.saved}
            error={detailsStatus.error}
            onSave={() => saveSection('details', DETAILS_KEYS)}
          />
        }
      >
        <SettingsField
          label="Instance name"
          htmlFor="instance-name"
          locked={lock('instance.name').locked}
          envVar={lock('instance.name').envVar}
        >
          <Input
            id="instance-name"
            value={values['instance.name'] as string}
            disabled={lock('instance.name').locked}
            onChange={(event) => setValue('instance.name', event.target.value)}
          />
        </SettingsField>

        <SettingsField
          label="Short description"
          htmlFor="instance-description"
          help="Shown in the instance picker and previews."
          locked={lock('instance.description').locked}
          envVar={lock('instance.description').envVar}
        >
          <Textarea
            id="instance-description"
            rows={3}
            value={values['instance.description'] as string}
            disabled={lock('instance.description').locked}
            onChange={(event) =>
              setValue('instance.description', event.target.value)
            }
          />
        </SettingsField>

        <SettingsField
          label="Contact email"
          htmlFor="instance-contact"
          help="Published in the instance API as the admin contact."
          locked={lock('instance.contactEmail').locked}
          envVar={lock('instance.contactEmail').envVar}
        >
          <Input
            id="instance-contact"
            type="email"
            value={values['instance.contactEmail'] as string}
            disabled={lock('instance.contactEmail').locked}
            onChange={(event) =>
              setValue('instance.contactEmail', event.target.value)
            }
          />
        </SettingsField>

        <SettingsField
          label="Languages"
          help="Primary languages of this instance, advertised for search and trends. The first one is the default."
          locked={lock('instance.languages').locked}
          envVar={lock('instance.languages').envVar}
        >
          <LanguagesPicker
            value={values['instance.languages'] as string[]}
            disabled={lock('instance.languages').locked}
            onChange={(next) => setValue('instance.languages', next)}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection
        title="Registrations"
        description="Control who can create an account on this instance."
        footer={
          <SaveBar
            dirty={isDirty(REGISTRATION_KEYS)}
            saving={registrationStatus.saving}
            saved={registrationStatus.saved}
            error={registrationStatus.error}
            onSave={() => saveSection('registrations', REGISTRATION_KEYS)}
          />
        }
      >
        <ControlRow
          label={
            registrationOpen
              ? 'Registrations are open'
              : 'Registrations are closed'
          }
          description={
            registrationOpen
              ? 'Anyone with an allowed email can sign up.'
              : 'New sign-ups are rejected; existing accounts are unaffected.'
          }
          htmlFor="registrations-open"
          locked={lock('registrations.open').locked}
          envVar={lock('registrations.open').envVar}
        >
          <Switch
            id="registrations-open"
            checked={registrationOpen}
            disabled={lock('registrations.open').locked}
            onCheckedChange={(checked) =>
              setValue('registrations.open', checked)
            }
          />
        </ControlRow>

        <SettingsField
          label="Allowed email addresses"
          htmlFor="registrations-allow-emails"
          help="One address per line. Leave empty to allow any email."
          locked={lock('registrations.allowEmails').locked}
          envVar={lock('registrations.allowEmails').envVar}
        >
          <LinesTextarea
            id="registrations-allow-emails"
            value={values['registrations.allowEmails'] as string[]}
            disabled={lock('registrations.allowEmails').locked}
            onChange={(next) => setValue('registrations.allowEmails', next)}
          />
        </SettingsField>
      </SettingsSection>
    </div>
  )
}

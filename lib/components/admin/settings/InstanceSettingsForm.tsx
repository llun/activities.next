'use client'

import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Input } from '@/lib/components/ui/input'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import {
  NAV_FEATURE_KEYS,
  type NavFeatureKey
} from '@/lib/services/navigation/navPreferences'

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
// Optional sections of the product. Off removes the item from everyone's
// navigation; the section itself keeps working for anyone who has a link.
// Keyed by the navigation registry's feature list rather than repeating it, so
// a feature added there is a type error here until it has a switch and the
// sentence that explains what turning it off does.
const FEATURE_COPY: Record<
  NavFeatureKey,
  { label: string; description: string }
> = {
  fitness: {
    label: 'Fitness',
    description:
      'Activity posts, the fitness dashboard, heatmaps, and Strava sync.'
  },
  explore: {
    label: 'Explore',
    description: 'Trends and follow suggestions.'
  },
  messages: {
    label: 'Messages',
    description: 'Direct conversations between accounts.'
  }
}

const FEATURES = NAV_FEATURE_KEYS.map((feature) => ({
  key: `features.${feature}`,
  id: `features-${feature}`,
  ...FEATURE_COPY[feature]
}))

const FEATURE_KEYS = FEATURES.map((feature) => feature.key)

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
      'registrations.allowEmails': settings.registrations.allowEmails,
      // Derived like the rows above it: seeded by hand, a feature added later
      // would start as undefined, which leaves its Switch uncontrolled and
      // reading "off" for something that is on.
      ...Object.fromEntries(
        NAV_FEATURE_KEYS.map((feature) => [
          `features.${feature}`,
          settings.features[feature]
        ])
      )
    })

  const lock = (key: string) => locks[key] ?? { locked: false }
  const detailsStatus = statusFor('details')
  const registrationStatus = statusFor('registrations')
  const featuresStatus = statusFor('features')
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

      <SettingsSection
        title="Optional features"
        description="Turn a feature off to remove it from navigation for every account on this instance."
        footer={
          <SaveBar
            dirty={isDirty(FEATURE_KEYS)}
            saving={featuresStatus.saving}
            saved={featuresStatus.saved}
            error={featuresStatus.error}
            onSave={() => saveSection('features', FEATURE_KEYS)}
          />
        }
      >
        {FEATURES.map((feature) => (
          <ControlRow
            key={feature.key}
            label={feature.label}
            description={feature.description}
            htmlFor={feature.id}
            locked={lock(feature.key).locked}
            envVar={lock(feature.key).envVar}
          >
            <Switch
              id={feature.id}
              checked={values[feature.key] as boolean}
              disabled={lock(feature.key).locked}
              onCheckedChange={(checked) => setValue(feature.key, checked)}
            />
          </ControlRow>
        ))}
      </SettingsSection>
    </div>
  )
}

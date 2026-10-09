'use client'

import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Switch } from '@/lib/components/ui/switch'
import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import type { ServerSettingLocks } from './InstanceSettingsForm'
import { NumberField } from './NumberField'
import { ControlRow, SettingsField } from './SettingsField'
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

const LINK_PREVIEW_KEYS = ['network.linkPreviews']
const SPECIES_LOOKUP_KEYS = ['network.speciesLookups']
const PLACE_LOOKUP_KEYS = ['network.placeLookups']

export const NetworkSettingsForm: FC<NetworkSettingsFormProps> = ({
  settings,
  locks
}) => {
  const { values, setValue, isDirty, statusFor, saveSection } =
    useServerSettingsForm({
      'network.requestTimeoutMs': settings.network.requestTimeoutMs,
      'network.requestRetries': settings.network.requestRetries,
      'network.maxResponseSizeBytes': settings.network.maxResponseSizeBytes,
      'network.linkPreviews': settings.network.linkPreviews,
      'network.speciesLookups': settings.network.speciesLookups,
      'network.placeLookups': settings.network.placeLookups
    })

  const lock = (key: string) => locks[key] ?? { locked: false }
  const status = statusFor('network')
  const linkPreviewStatus = statusFor('linkPreviews')
  const speciesLookupStatus = statusFor('speciesLookups')
  const placeLookupStatus = statusFor('placeLookups')
  const responseBytes = values['network.maxResponseSizeBytes'] as number

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network"
        description="How this server talks to the rest of the network. Integrations like translation and maps are configured in the environment."
      />

      <Section
        title="Link previews"
        description="Fetch a preview card for the first link in a post, so timelines show its title, description and thumbnail."
      >
        <Frame
          divided
          footer={
            <SaveBar
              dirty={isDirty(LINK_PREVIEW_KEYS)}
              saving={linkPreviewStatus.saving}
              saved={linkPreviewStatus.saved}
              error={linkPreviewStatus.error}
              onSave={() => saveSection('linkPreviews', LINK_PREVIEW_KEYS)}
            />
          }
        >
          <ControlRow
            label="Fetch link previews"
            description="Off stops this server requesting pages that people link to. Cards already stored keep showing."
            htmlFor="network-link-previews"
            locked={lock('network.linkPreviews').locked}
            envVar={lock('network.linkPreviews').envVar}
          >
            <Switch
              id="network-link-previews"
              checked={values['network.linkPreviews'] as boolean}
              disabled={lock('network.linkPreviews').locked}
              onCheckedChange={(checked) =>
                setValue('network.linkPreviews', checked)
              }
            />
          </ControlRow>
        </Frame>
      </Section>

      <Section
        title="Species lookups"
        description="Check the subject of a gallery photo against the GBIF taxonomy. On by default; the server it asks can be changed in the environment."
      >
        <Frame
          divided
          footer={
            <SaveBar
              dirty={isDirty(SPECIES_LOOKUP_KEYS)}
              saving={speciesLookupStatus.saving}
              saved={speciesLookupStatus.saved}
              error={speciesLookupStatus.error}
              onSave={() => saveSection('speciesLookups', SPECIES_LOOKUP_KEYS)}
            />
          }
        >
          <ControlRow
            label="Look up species"
            description="Checks subject names against the GBIF taxonomy and the IUCN Red List status it carries. Off stops new requests to GBIF. While people hide threatened species places, photos whose species cannot be checked keep their place hidden from others."
            htmlFor="network-species-lookups"
            locked={lock('network.speciesLookups').locked}
            envVar={lock('network.speciesLookups').envVar}
          >
            <Switch
              id="network-species-lookups"
              checked={values['network.speciesLookups'] as boolean}
              disabled={lock('network.speciesLookups').locked}
              onCheckedChange={(checked) =>
                setValue('network.speciesLookups', checked)
              }
            />
          </ControlRow>
        </Frame>
      </Section>

      <Section
        title="Place names"
        description="Name the place a gallery photo was taken from its coordinates. On by default; the server it asks can be changed in the environment."
      >
        <Frame
          divided
          footer={
            <SaveBar
              dirty={isDirty(PLACE_LOOKUP_KEYS)}
              saving={placeLookupStatus.saving}
              saved={placeLookupStatus.saved}
              error={placeLookupStatus.error}
              onSave={() => saveSection('placeLookups', PLACE_LOOKUP_KEYS)}
            />
          }
        >
          <ControlRow
            label="Look up place names"
            description="Asks OpenStreetMap Nominatim for a name. Only the centre of a roughly 5 km grid cell is sent, never the photo's exact point. Off stops new requests; names already stored stay."
            htmlFor="network-place-lookups"
            locked={lock('network.placeLookups').locked}
            envVar={lock('network.placeLookups').envVar}
          >
            <Switch
              id="network-place-lookups"
              checked={values['network.placeLookups'] as boolean}
              disabled={lock('network.placeLookups').locked}
              onCheckedChange={(checked) =>
                setValue('network.placeLookups', checked)
              }
            />
          </ControlRow>
        </Frame>
      </Section>

      <Section
        title="Advanced — outbound requests"
        description="How this server talks to other servers. Defaults are fine for almost everyone."
      >
        <Frame
          divided
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
        </Frame>
      </Section>
    </div>
  )
}

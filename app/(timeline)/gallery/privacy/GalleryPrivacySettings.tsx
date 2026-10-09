'use client'

import { Camera, Globe, Images, MapPin } from 'lucide-react'
import { FC } from 'react'

import { getGallerySettings, updateGallerySettings } from '@/lib/client'
import {
  PrivacyLocationInput,
  PrivacyLocationsCopy,
  PrivacyLocationsEditor,
  PrivacyLocationsSaveError
} from '@/lib/components/privacy-locations/PrivacyLocationsEditor'
import {
  GallerySettingsStatus,
  useGallerySettingsForm
} from '@/lib/components/settings/gallerySettingsForm'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { parseGalleryHiddenLocations } from '@/lib/services/gallery/hiddenLocations'
import {
  GALLERY_DEFAULTS,
  type GalleryDefault,
  type GallerySettings,
  MEDIA_PLACE_PRECISIONS,
  type MediaPlacePrecision
} from '@/lib/types/database/gallery'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

type SettingKey = keyof Pick<
  GallerySettings,
  | 'defaultPlacePrecision'
  | 'hideThreatenedPlaces'
  | 'galleryDefault'
  | 'showGear'
  | 'mapPublic'
  | 'lifeListPublic'
>

const PRECISION_LABELS: Record<MediaPlacePrecision, string> = {
  hidden: 'Hidden',
  country: 'Country',
  area: 'Area (about 5 km)',
  exact: 'Exact'
}

const GALLERY_DEFAULT_LABELS: Record<GalleryDefault, string> = {
  subject: 'When it has a subject',
  always: 'Always',
  never: 'Never'
}

const HIDDEN_LOCATIONS_COPY: PrivacyLocationsCopy = {
  saved: 'Hidden locations saved.',
  cleared: 'Hidden locations cleared.',
  saveFailed: 'Failed to save hidden locations',
  saveButton: 'Save hidden locations',
  hideRadiusHelp:
    'Photos and videos taken inside this area never show a place to other people, at any precision. You still see them with their place.'
}

const loadHiddenLocations = async (): Promise<PrivacyLocationInput[]> =>
  parseGalleryHiddenLocations((await getGallerySettings()).hiddenLocations)

const saveHiddenLocations = async (
  locations: PrivacyLocationInput[]
): Promise<PrivacyLocationInput[]> => {
  try {
    const saved = await updateGallerySettings({ hiddenLocations: locations })
    return parseGalleryHiddenLocations(saved.hiddenLocations)
  } catch (error) {
    throw new PrivacyLocationsSaveError(
      error instanceof Error ? error.message : HIDDEN_LOCATIONS_COPY.saveFailed
    )
  }
}

interface SelectRowProps {
  id: string
  label: string
  description: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled: boolean
  busy: boolean
  onChange: (value: string) => void
}

const SelectRow: FC<SelectRowProps> = ({
  id,
  label,
  description,
  value,
  options,
  disabled,
  busy,
  onChange
}) => (
  <FormRow label={label} htmlFor={id} hint={description}>
    {({ describedBy }) => (
      <Select
        id={id}
        aria-describedby={describedBy}
        value={value}
        disabled={disabled}
        aria-busy={busy}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    )}
  </FormRow>
)

interface ToggleRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  /** A save is in flight: announced, but the control stays enabled and focused. */
  busy: boolean
  notice?: string
  onCheckedChange: (checked: boolean) => void
}

// The switch stays at the end of the label's row on a phone too (`inline`).
const ToggleRow: FC<ToggleRowProps> = ({
  id,
  label,
  description,
  checked,
  disabled,
  busy,
  notice,
  onCheckedChange
}) => (
  <FormRow
    label={label}
    htmlFor={id}
    inline
    hint={
      <>
        {description}
        {notice ? <span className="mt-0.5 block">{notice}</span> : null}
      </>
    }
  >
    {({ describedBy }) => (
      <Switch
        id={id}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        aria-busy={busy}
        onCheckedChange={onCheckedChange}
      />
    )}
  </FormRow>
)

interface Props {
  /** Which map backend renders the hidden-locations picker. */
  mapProvider: PublicMapProvider
}

/**
 * Gallery › Privacy: where photos show on the map, which details others see,
 * and what goes in the gallery. Each control saves on its own, so a failed save
 * reverts only that control; the hidden locations use the editor Fitness's
 * privacy page shares and save with their own button.
 */
export const GalleryPrivacySettings: FC<Props> = ({ mapProvider }) => {
  const {
    settings,
    loaded,
    loadError,
    saveError,
    savedStatus,
    savingKeys,
    loadSettings,
    save
  } = useGallerySettingsForm<SettingKey>({
    saveError: 'Failed to save privacy settings. Please try again.',
    loadError: 'Failed to load privacy settings.'
  })

  return (
    <div className="space-y-6">
      <GallerySettingsStatus
        loadError={loadError}
        saveError={saveError}
        savedStatus={savedStatus}
        onRetry={loadSettings}
      />

      <Section
        icon={MapPin}
        title="Place"
        description="How precisely a photo’s place is shown to others. Only you ever see the exact coordinates."
      >
        <Frame divided>
          <SelectRow
            id="gallery-default-place-precision"
            label="Default precision for new media"
            description="You can change it on each photo. GPS is always removed from the file itself."
            value={settings?.defaultPlacePrecision ?? 'hidden'}
            options={MEDIA_PLACE_PRECISIONS.map((value) => ({
              value,
              label: PRECISION_LABELS[value]
            }))}
            disabled={!loaded}
            busy={savingKeys.has('defaultPlacePrecision')}
            onChange={(value) =>
              save('defaultPlacePrecision', value as MediaPlacePrecision)
            }
          />
          <ToggleRow
            id="gallery-hide-threatened-places"
            label="Hide the place for threatened species"
            description="Uses IUCN status from GBIF. Overrides the precision above."
            checked={settings?.hideThreatenedPlaces ?? true}
            disabled={!loaded}
            busy={savingKeys.has('hideThreatenedPlaces')}
            // Until the settings load the availability flags are unknown, so no
            // notice flashes. The rule fails closed, so both states say what a
            // species photo's place does until its status is known; with the
            // switch off neither holds, so there is no notice.
            notice={
              !settings || !settings.hideThreatenedPlaces
                ? undefined
                : settings.speciesLookupsAvailable
                  ? 'A species’ place stays hidden until GBIF confirms the species and it isn’t threatened.'
                  : 'This server can’t check IUCN status, so places of photos with a species name stay hidden while this is on.'
            }
            onCheckedChange={(checked) => save('hideThreatenedPlaces', checked)}
          />
          {settings ? (
            <p className="text-muted-foreground px-4 py-3 text-xs">
              {settings.placeLookupsAvailable
                ? 'Place names for photos with GPS come from OpenStreetMap’s Nominatim. It is sent only the centre of the roughly 5 km area around a photo, never the exact point, even when the place is hidden.'
                : 'This server doesn’t look up place names, so you type them yourself.'}
            </p>
          ) : null}
        </Frame>
      </Section>

      <Section
        icon={Globe}
        title="Hidden locations"
        description="Media taken inside these areas never shows a place to others, at any precision."
      >
        {/* The editor is itself the flat `rounded-lg border` frame (Fitness's
            privacy page shares it), so it is not wrapped in a second one. */}
        <PrivacyLocationsEditor
          mapProvider={mapProvider}
          load={loadHiddenLocations}
          save={saveHiddenLocations}
          copy={HIDDEN_LOCATIONS_COPY}
          mapIdPrefix="gallery-hidden-locations"
        />
      </Section>

      <Section icon={Camera} title="Gear and exposure">
        <Frame divided>
          <ToggleRow
            id="gallery-show-gear"
            label="Show gear and exposure on my media"
            description="Camera, lens and settings appear in the viewer and the gallery, never in the timeline."
            checked={settings?.showGear ?? false}
            disabled={!loaded}
            busy={savingKeys.has('showGear')}
            onCheckedChange={(checked) => save('showGear', checked)}
          />
        </Frame>
      </Section>

      <Section icon={Images} title="Gallery">
        <Frame divided>
          <SelectRow
            id="gallery-default"
            label="Add new photos and videos to my gallery"
            description="You can change it per item in media details."
            value={settings?.galleryDefault ?? 'subject'}
            options={GALLERY_DEFAULTS.map((value) => ({
              value,
              label: GALLERY_DEFAULT_LABELS[value]
            }))}
            disabled={!loaded}
            busy={savingKeys.has('galleryDefault')}
            onChange={(value) =>
              save('galleryDefault', value as GalleryDefault)
            }
          />
          <ToggleRow
            id="gallery-map-public"
            label="Show my gallery map to others"
            description="Others see only the places you allow, at the precision you chose."
            checked={settings?.mapPublic ?? false}
            disabled={!loaded}
            busy={savingKeys.has('mapPublic')}
            onCheckedChange={(checked) => save('mapPublic', checked)}
          />
          <ToggleRow
            id="gallery-life-list-public"
            label="Let others see my life list"
            description="When off, only you see the life list and species counts."
            checked={settings?.lifeListPublic ?? false}
            disabled={!loaded}
            busy={savingKeys.has('lifeListPublic')}
            onCheckedChange={(checked) => save('lifeListPublic', checked)}
          />
        </Frame>
      </Section>
    </div>
  )
}
